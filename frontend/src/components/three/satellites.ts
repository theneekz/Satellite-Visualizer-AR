import {
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  Vector2,
  type Matrix4,
  type Vector3,
} from "three/webgpu";
import {
  attribute,
  cameraProjectionMatrix,
  float,
  instanceIndex,
  modelViewMatrix,
  positionGeometry,
  select,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  FLOATS_PER_SATELLITE,
  type PositionsSnapshot,
} from "../../api/satellites";

// Same values as the WebGPU renderer (components/satellite.ts), so the two look identical.
const EARTH_RADIUS_KM = 6371;
const SATELLITE_SIZE_PX = 12;
// In XR, satellites are sized by angle rather than pixels: this is the square's full width, about
// what SATELLITE_SIZE_PX spans on a desktop screen.
const SATELLITE_SIZE_XR_RAD = 0.01;
// A click selects the nearest satellite within this many pixels.
const PICK_RADIUS_PX = 10;
// An XR controller ray selects the satellite nearest its aim within this angle (about 1.5 degrees).
const PICK_RAY_ANGLE_RAD = 0.026;

// One quad as two triangles; each corner is offset in screen space by the vertex shader.
const QUAD_CORNERS = new Float32Array([
  -1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0,
]);

/**
 * Whether the segment from (ox, oy, oz) to (ox + dx, oy + dy, oz + dz) passes through the unit
 * globe at the origin, i.e. whether the globe hides its far end from its near end.
 */
function segmentHitsGlobe(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number
) {
  const t = Math.min(
    1,
    Math.max(0, -(ox * dx + oy * dy + oz * dz) / (dx * dx + dy * dy + dz * dz))
  );
  const cx = ox + dx * t;
  const cy = oy + dy * t;
  const cz = oz + dz * t;
  return cx * cx + cy * cy + cz * cz < 1;
}

/**
 * Every satellite as one instanced draw of screen-facing squares. Each instance holds its polled
 * GCRS position and velocity; the vertex shader moves it in a straight line by the time since the
 * snapshot, exactly like the WebGPU renderer. The mesh belongs in the inertial (camera-rotated)
 * group, not in the spinning Earth.
 */
export function createSatellites() {
  // Seconds since the snapshot, the drawing buffer size in pixels, and the selected instance
  // (-1 for none). A float index is exact far beyond any realistic satellite count.
  const dt = uniform(0);
  const viewport = uniform(new Vector2(1, 1));
  const selectedIndex = uniform(-1);
  // 1 to size satellites by angle (XR), 0 to size them in pixels.
  const angularSizing = uniform(0);

  const isSelected = instanceIndex.toFloat().equal(selectedIndex);
  const gcrs = attribute("satPosition", "vec3").add(
    attribute("satVelocity", "vec3").mul(dt)
  );
  // GCRS has Z as the polar axis; the scene uses Y. Proper rotation (no mirroring), then km are
  // scaled so the Earth's radius is 1 like the globe mesh.
  const local = vec3(gcrs.x, gcrs.z, gcrs.y.negate()).div(EARTH_RADIUS_KM);
  const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(local, 1));
  const sizeScale = select(isSelected, float(2), float(1));
  // Offset in clip space, scaled by w so the square keeps a constant on-screen size: in pixels of
  // the drawing buffer, or (in XR) as an angle through the projection's focal lengths, which keeps
  // it square in each eye whatever the size and shape of the buffer that eye is drawn into.
  const pixelOffset = positionGeometry.xy
    .mul(sizeScale.mul(SATELLITE_SIZE_PX))
    .div(viewport);
  const focalLengths = vec2(
    cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x,
    cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y
  );
  const angularOffset = positionGeometry.xy
    .mul(focalLengths)
    .mul(sizeScale.mul(Math.tan(SATELLITE_SIZE_XR_RAD / 2)));
  const offset = select(
    angularSizing.greaterThan(0.5),
    angularOffset,
    pixelOffset
  ).mul(clip.w);

  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.vertexNode = vec4(clip.xy.add(offset), clip.z, clip.w);
  material.colorNode = select(
    varying(select(isSelected, float(1), float(0))).greaterThan(0.5),
    vec3(0.52, 0.72, 0.92),
    vec3(1, 0.85, 0.2)
  );

  let capacity = 0;
  let instanceBuffer: InstancedInterleavedBuffer | null = null;
  const mesh = new Mesh(createGeometry(0), material);
  // Positions come from the shader, so the geometry's bounds mean nothing for culling.
  mesh.frustumCulled = false;
  // Hidden until there is something to draw, so an empty instance buffer is never uploaded.
  mesh.visible = false;

  function createGeometry(instances: number) {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(QUAD_CORNERS, 3));
    instanceBuffer = new InstancedInterleavedBuffer(
      new Float32Array(instances * FLOATS_PER_SATELLITE),
      FLOATS_PER_SATELLITE
    ).setUsage(DynamicDrawUsage);
    geometry.setAttribute(
      "satPosition",
      new InterleavedBufferAttribute(instanceBuffer, 3, 0)
    );
    geometry.setAttribute(
      "satVelocity",
      new InterleavedBufferAttribute(instanceBuffer, 3, 3)
    );
    geometry.instanceCount = 0;
    capacity = instances;
    return geometry;
  }

  // CPU copy of what is drawn (the instance buffer's live contents) and its ids, for picking and
  // for following a selected satellite.
  let count = 0;
  let ids: ArrayLike<number> = [];
  let indexById = new Map<number, number>();
  let snapshotTimeMs = 0;
  let selectedId: number | null = null;

  function resolveSelectedIndex() {
    selectedIndex.value =
      selectedId === null ? -1 : (indexById.get(selectedId) ?? -1);
  }

  /** Uploads a snapshot. If `visibleIds` is given, only those satellites are drawn and pickable. */
  function setPositions(
    snapshot: PositionsSnapshot,
    visibleIds: Set<number> | null
  ) {
    snapshotTimeMs = snapshot.t;
    const n = snapshot.ids.length;

    // Only reallocate when the satellite count outgrows the buffer.
    if (n > capacity) {
      mesh.geometry.dispose();
      mesh.geometry = createGeometry(n);
    }
    const data = instanceBuffer!.array as Float32Array;

    if (!visibleIds) {
      // Unfiltered: the snapshot's state block already has the instance buffer's layout.
      data.set(snapshot.state);
      ids = snapshot.ids;
      indexById = snapshot.indexById;
      count = n;
    } else {
      const filteredIds: number[] = [];
      indexById = new Map();
      for (let i = 0; i < n; i++) {
        const id = snapshot.ids[i];
        if (!visibleIds.has(id)) continue;
        const from = i * FLOATS_PER_SATELLITE;
        data.set(
          snapshot.state.subarray(from, from + FLOATS_PER_SATELLITE),
          filteredIds.length * FLOATS_PER_SATELLITE
        );
        indexById.set(id, filteredIds.length);
        filteredIds.push(id);
      }
      ids = filteredIds;
      count = filteredIds.length;
    }

    instanceBuffer!.needsUpdate = true;
    (mesh.geometry as InstancedBufferGeometry).instanceCount = count;
    mesh.visible = count > 0;
    resolveSelectedIndex();
  }

  /** Highlights the satellite with this NORAD id, or clears the highlight with null. */
  function setSelected(id: number | null) {
    if (id === selectedId) return;
    selectedId = id;
    resolveSelectedIndex();
  }

  /** Sizes satellites by angle (for XR, where pixels aren't meaningful) or in pixels. */
  function setAngularSizing(enabled: boolean) {
    angularSizing.value = enabled ? 1 : 0;
  }

  /** Per-frame uniforms: the simulated time and the drawing buffer size in pixels. */
  function update(
    simTimeMs: number,
    viewportWidth: number,
    viewportHeight: number
  ) {
    dt.value = (simTimeMs - snapshotTimeMs) / 1000;
    viewport.value.set(viewportWidth, viewportHeight);
  }

  /** The drawn position (inertial group space, Earth radius = 1) of instance `index`, into `out`. */
  function positionAt(index: number, out: number[]) {
    const data = instanceBuffer!.array as Float32Array;
    const o = index * FLOATS_PER_SATELLITE;
    const t = dt.value;
    out[0] = (data[o] + data[o + 3] * t) / EARTH_RADIUS_KM;
    out[1] = (data[o + 2] + data[o + 5] * t) / EARTH_RADIUS_KM;
    out[2] = -(data[o + 1] + data[o + 4] * t) / EARTH_RADIUS_KM;
  }
  const scratch = [0, 0, 0];

  /** Where the satellite with this id is drawn right now, or null if it isn't drawn. */
  function scenePosition(id: number): [number, number, number] | null {
    const index = indexById.get(id);
    if (index === undefined) return null;
    positionAt(index, scratch);
    return [scratch[0], scratch[1], scratch[2]];
  }

  /**
   * The id of the satellite nearest canvas pixel (px, py) within PICK_RADIUS_PX, or null. `mvp`
   * (projection * view * inertial group) and `model` (the inertial group's world matrix) are the
   * matrices the satellites were drawn with; satellites hidden behind the globe are skipped.
   */
  function pick(
    mvp: Matrix4,
    model: Matrix4,
    cameraDistance: number,
    viewportWidth: number,
    viewportHeight: number,
    px: number,
    py: number
  ): number | null {
    const m = mvp.elements;
    const r = model.elements;
    let best = -1;
    let bestDist2 = PICK_RADIUS_PX * PICK_RADIUS_PX;

    for (let i = 0; i < count; i++) {
      positionAt(i, scratch);
      const [x, y, z] = scratch;

      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0) continue;
      const ndcX = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const ndcY = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      const dx = (ndcX * 0.5 + 0.5) * viewportWidth - px;
      const dy = (0.5 - ndcY * 0.5) * viewportHeight - py;
      const dist2 = dx * dx + dy * dy;
      if (dist2 >= bestDist2) continue;

      // Hidden if the segment from the camera (0, 0, cameraDistance) to the satellite passes
      // through the unit globe.
      const wx = r[0] * x + r[4] * y + r[8] * z;
      const wy = r[1] * x + r[5] * y + r[9] * z;
      const wz = r[2] * x + r[6] * y + r[10] * z - cameraDistance;
      if (segmentHitsGlobe(0, 0, cameraDistance, wx, wy, wz)) continue;

      best = i;
      bestDist2 = dist2;
    }
    return best === -1 ? null : ids[best];
  }

  /**
   * The id of the satellite nearest the aim of a ray (an XR controller's) within
   * PICK_RAY_ANGLE_RAD, or null. `origin` and the normalized `direction` are in inertial group
   * space, where the globe is the unit sphere; satellites hidden behind the globe are skipped.
   */
  function pickRay(origin: Vector3, direction: Vector3): number | null {
    let best = -1;
    let bestCos = Math.cos(PICK_RAY_ANGLE_RAD);

    for (let i = 0; i < count; i++) {
      positionAt(i, scratch);
      const dx = scratch[0] - origin.x;
      const dy = scratch[1] - origin.y;
      const dz = scratch[2] - origin.z;
      const length = Math.hypot(dx, dy, dz);
      if (length === 0) continue;
      const cos =
        (dx * direction.x + dy * direction.y + dz * direction.z) / length;
      if (cos <= bestCos) continue;
      if (segmentHitsGlobe(origin.x, origin.y, origin.z, dx, dy, dz)) continue;

      best = i;
      bestCos = cos;
    }
    return best === -1 ? null : ids[best];
  }

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
  }

  return {
    mesh,
    setPositions,
    setSelected,
    setAngularSizing,
    update,
    scenePosition,
    pick,
    pickRay,
    dispose,
  };
}
