import {
  FLOATS_PER_SATELLITE,
  type PositionsSnapshot,
} from "../api/satellites";
import { EARTH_RADIUS_KM } from "../constants";
import {
  SATELLITE_SIZE_PX,
  pickNearest,
  scenePositionAt,
} from "./satelliteScene";

// Demo only: real-time LEO motion is barely visible, so run the simulation faster.
const TIME_SCALE = 1;

const SHADER_SOURCE = /* wgsl */ `
  struct Uniforms {
    mvp: mat4x4f,
    viewport: vec2f,
    sizePx: f32,
    dt: f32,
    selectedIndex: i32,
  }
  @group(0) @binding(0) var<uniform> uniforms: Uniforms;

  struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(flat) selected: f32,
  }

  @vertex
  fn vs_main(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
    @location(0) position: vec3f,
    @location(1) velocity: vec3f,
  ) -> VertexOutput {
    var corners = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
      vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    );
    // Straight-line step from the snapshot's state (TEME, km) to the current time.
    let teme = position + velocity * uniforms.dt;
    // TEME has Z as the polar axis; the globe uses Y. This is a proper rotation (no mirroring),
    // then km are scaled so the Earth's radius is 1 like the globe mesh.
    let world = vec3f(teme.x, teme.z, -teme.y) / ${EARTH_RADIUS_KM};
    let clip = uniforms.mvp * vec4f(world, 1.0);
    // The selected satellite is drawn twice as large.
    let isSelected = i32(instanceIndex) == uniforms.selectedIndex;
    let size = select(uniforms.sizePx, uniforms.sizePx * 2.0, isSelected);
    // Offset in clip space, scaled by w so the square keeps a constant on-screen size.
    let offset = corners[vertexIndex] * size / uniforms.viewport * clip.w;

    var out: VertexOutput;
    out.position = vec4f(clip.xy + offset, clip.z, clip.w);
    out.selected = select(0.0, 1.0, isSelected);
    return out;
  }

  @fragment
  fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let base = vec4f(1.0, 0.85, 0.2, 1.0);
    let highlight = vec4f(0.52, 0.72, 0.92, 1.0);
    return select(base, highlight, in.selected > 0.5);
  }
`;

/**
 * Draws every satellite in the latest snapshot as a small square in the same render pass as the
 * globe. Each satellite is one instance holding its propagated position and velocity; the vertex
 * shader moves it in a straight line by the time elapsed since the snapshot. That is accurate to
 * a few km over the ~30 s between snapshots, and each new snapshot re-anchors it.
 */
export function createSatelliteRenderer(
  device: GPUDevice,
  format: GPUTextureFormat
) {
  // Until positions arrive nothing is drawn.
  let count = 0;
  let snapshotTimeMs = 0;
  let instanceBuffer: GPUBuffer | null = null;
  // CPU copy of the instance data and its ids, kept so clicks can be matched to satellites.
  let instanceData = new Float32Array(0);
  // May be the snapshot's own arrays (unfiltered), so never mutate them in place.
  let ids: ArrayLike<number> = [];
  let indexById = new Map<number, number>();
  let selectedId: number | null = null;
  let selectedIndex = -1;

  // The simulated "now" the satellites are at, so the Earth can be rotated to the same instant.
  let simTimeMs = Date.now();

  // mat4x4f (64) + vec2f viewport (8) + f32 sizePx (4) + f32 dt (4) + i32 selectedIndex (4),
  // padded to 96. The Int32Array shares memory with the Float32Array for the integer field.
  const uniformBuffer = device.createBuffer({
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformData = new Float32Array(24);
  const uniformInts = new Int32Array(uniformData.buffer);

  const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: FLOATS_PER_SATELLITE * 4,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function resolveSelectedIndex() {
    selectedIndex =
      selectedId === null ? -1 : (indexById.get(selectedId) ?? -1);
  }

  /**
   * Uploads the position and velocity of each satellite in a snapshot. If `visibleIds` is given,
   * only those satellites are drawn (and can be picked); null means all of them.
   */
  function setPositions(
    snapshot: PositionsSnapshot,
    visibleIds: Set<number> | null
  ) {
    snapshotTimeMs = snapshot.t;

    if (!visibleIds) {
      // Unfiltered: the snapshot's state block is already laid out like the instance buffer.
      ids = snapshot.ids;
      indexById = snapshot.indexById;
      count = ids.length;
      instanceData = snapshot.state;
    } else {
      // Filtered
      const { state } = snapshot;
      const data = new Float32Array(state.length);
      const filteredIds: number[] = [];
      indexById = new Map();
      let n = 0;
      for (let i = 0; i < snapshot.ids.length; i++) {
        const id = snapshot.ids[i];
        if (!visibleIds.has(id)) continue;
        data.set(
          state.subarray(
            i * FLOATS_PER_SATELLITE,
            (i + 1) * FLOATS_PER_SATELLITE
          ),
          n * FLOATS_PER_SATELLITE
        );
        filteredIds.push(id);
        indexById.set(id, n);
        n++;
      }
      ids = filteredIds;
      count = n;
      instanceData = data.subarray(0, n * FLOATS_PER_SATELLITE);
    }
    resolveSelectedIndex();
    if (count === 0) return;

    // Only reallocate when the satellite count outgrows the buffer.
    if (!instanceBuffer || instanceBuffer.size < instanceData.byteLength) {
      instanceBuffer?.destroy();
      instanceBuffer = device.createBuffer({
        size: instanceData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    device.queue.writeBuffer(instanceBuffer, 0, instanceData);
  }

  const scratch = [0, 0, 0];

  /** Where the satellite with this id is right now in globe units, or null if it isn't drawn. */
  function scenePosition(id: number): [number, number, number] | null {
    const index = indexById.get(id);
    if (index === undefined) return null;
    const dt = (simTimeMs - snapshotTimeMs) / 1000;
    scenePositionAt(instanceData, index, dt, scratch);
    return [scratch[0], scratch[1], scratch[2]];
  }

  /** Highlights the satellite with this NORAD id, or clears the highlight with null. */
  function setSelected(id: number | null) {
    if (id === selectedId) return;
    selectedId = id;
    resolveSelectedIndex();
  }

  /**
   * Returns the id of the satellite nearest a click at canvas pixel (px, py), or null if none is
   * within PICK_RADIUS_PX. `mvp` and `model` are the same camera matrices the satellites are drawn
   * with; satellites hidden behind the globe are skipped.
   */
  function pick(
    mvp: Float32Array,
    model: Float32Array,
    cameraDistance: number,
    viewportWidth: number,
    viewportHeight: number,
    px: number,
    py: number
  ): number | null {
    const best = pickNearest(
      instanceData,
      count,
      (simTimeMs - snapshotTimeMs) / 1000,
      mvp,
      model,
      cameraDistance,
      viewportWidth,
      viewportHeight,
      px,
      py
    );
    return best === -1 ? null : ids[best];
  }

  /** Advances the simulated clock by `dtSeconds` of wall-clock time (scaled by TIME_SCALE). */
  function step(dtSeconds: number) {
    simTimeMs += dtSeconds * TIME_SCALE * 1000;
  }

  /** Uploads the camera transform and the time since the snapshot. `mvp` must include the globe's model rotation. */
  function update(
    mvp: Float32Array,
    viewportWidth: number,
    viewportHeight: number
  ) {
    uniformData.set(mvp, 0);
    uniformData[16] = viewportWidth;
    uniformData[17] = viewportHeight;
    uniformData[18] = SATELLITE_SIZE_PX;
    uniformData[19] = (simTimeMs - snapshotTimeMs) / 1000;
    uniformInts[20] = selectedIndex;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  }

  function draw(pass: GPURenderPassEncoder) {
    if (count === 0 || !instanceBuffer) return;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, instanceBuffer);
    pass.draw(6, count);
  }

  return {
    setPositions,
    setSelected,
    scenePosition,
    pick,
    step,
    update,
    draw,
    simTime: () => simTimeMs,
  };
}
