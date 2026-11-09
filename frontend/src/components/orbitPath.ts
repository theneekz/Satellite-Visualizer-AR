import { ORBIT_PATH_SEGMENTS, type OrbitPath } from "../api/satellites";
import {
  FLOATS_PER_ORBIT_SEGMENT,
  ORBIT_PATH_COLOR,
  ORBIT_PATH_WIDTH_PX,
  writeOrbitSegments,
} from "./satelliteScene";

const SHADER_SOURCE = /* wgsl */ `
  struct Uniforms {
    mvp: mat4x4f,
    viewport: vec2f,
    widthPx: f32,
  }
  @group(0) @binding(0) var<uniform> uniforms: Uniforms;

  // A segment that crosses behind the camera would project to the wrong place, so its hidden end
  // is moved along the segment to just in front of the camera.
  const MIN_W = 0.001;
  fn trimToFront(point: vec4f, other: vec4f) -> vec4f {
    if (point.w >= MIN_W) {
      return point;
    }
    return mix(point, other, clamp((MIN_W - point.w) / (other.w - point.w), 0.0, 1.0));
  }

  @vertex
  fn vs_main(
    @builtin(vertex_index) vertexIndex: u32,
    @location(0) start: vec3f,
    @location(1) end: vec3f,
  ) -> @builtin(position) vec4f {
    // x picks the segment's end and y picks its side.
    var corners = array<vec2f, 6>(
      vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
      vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    );
    let corner = corners[vertexIndex];
    let startRaw = uniforms.mvp * vec4f(start, 1.0);
    let endRaw = uniforms.mvp * vec4f(end, 1.0);
    let a = trimToFront(startRaw, endRaw);
    let b = trimToFront(endRaw, startRaw);

    // The segment's direction in pixels, turned 90 degrees to get the side to widen toward.
    let pixels = (b.xy / b.w - a.xy / a.w) * uniforms.viewport;
    let direction = pixels / max(length(pixels), 0.000001);
    let side = vec2f(-direction.y, direction.x);
    let clip = select(a, b, corner.x > 0.5);
    let offset = side * corner.y * uniforms.widthPx / uniforms.viewport * clip.w;
    return vec4f(clip.xy + offset, clip.z, clip.w);
  }

  @fragment
  fn fs_main() -> @location(0) vec4f {
    return vec4f(${ORBIT_PATH_COLOR.join(", ")}, 1.0);
  }
`;

/**
 * Draws the selected satellite's orbit in the same render pass as the globe. WebGPU lines are
 * always 1 pixel wide, so each segment is an instanced screen-facing strip instead.
 */
export function createOrbitPathRenderer(
  device: GPUDevice,
  format: GPUTextureFormat
) {
  // mat4x4f (64) + vec2f viewport (8) + f32 widthPx (4), padded to 80.
  const uniformBuffer = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformData = new Float32Array(20);
  // Sized for the longest path, so a refresh never reallocates.
  const segmentData = new Float32Array(
    ORBIT_PATH_SEGMENTS * FLOATS_PER_ORBIT_SEGMENT
  );
  const segmentBuffer = device.createBuffer({
    size: segmentData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: FLOATS_PER_ORBIT_SEGMENT * 4,
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
    // The globe hides the far side of the orbit. The line writes no depth, so it can't hide the
    // satellites drawn after it.
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  let current: OrbitPath | null = null;
  let segmentCount = 0;

  /** Shows this path, or nothing for null. Only uploads when the path changes. */
  function setPath(path: OrbitPath | null) {
    if (path === current) return;
    current = path;
    segmentCount = path ? writeOrbitSegments(path.points, segmentData) : 0;
    if (segmentCount > 0) {
      device.queue.writeBuffer(
        segmentBuffer,
        0,
        segmentData,
        0,
        segmentCount * FLOATS_PER_ORBIT_SEGMENT
      );
    }
  }

  /** `mvp` must include the camera's rotation but not the Earth's spin, like the satellites'. */
  function update(
    mvp: Float32Array,
    viewportWidth: number,
    viewportHeight: number
  ) {
    if (segmentCount === 0) return;
    uniformData.set(mvp, 0);
    uniformData[16] = viewportWidth;
    uniformData[17] = viewportHeight;
    uniformData[18] = ORBIT_PATH_WIDTH_PX;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  }

  function draw(pass: GPURenderPassEncoder) {
    if (segmentCount === 0) return;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, segmentBuffer);
    pass.draw(6, segmentCount);
  }

  return { setPath, update, draw };
}
