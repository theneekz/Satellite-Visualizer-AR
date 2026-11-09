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
} from "three/webgpu";
import {
  attribute,
  cameraProjectionMatrix,
  clamp,
  float,
  length,
  max,
  mix,
  modelViewMatrix,
  positionGeometry,
  select,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { ORBIT_PATH_SEGMENTS, type OrbitPath } from "../../api/satellites";
import {
  FLOATS_PER_ORBIT_SEGMENT,
  ORBIT_PATH_COLOR,
  ORBIT_PATH_WIDTH_PX,
  writeOrbitSegments,
} from "../satelliteScene";

// In XR, the line is sized by angle rather than pixels, so it covers several headset pixels and
// doesn't shimmer as the head moves. This is its full width.
const ORBIT_PATH_WIDTH_XR_RAD = 0.003;
// A segment that crosses behind the camera would project to the wrong place, so its hidden end is
// moved along the segment to just in front of the camera.
const MIN_W = 0.001;

// One strip as two triangles: x picks the segment's end and y picks its side.
const STRIP_CORNERS = new Float32Array([
  0, -1, 0, 1, -1, 0, 0, 1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0,
]);

/**
 * The selected satellite's orbit, as one instanced draw of screen-facing strips. Lines in WebGL and
 * WebGPU are always 1 pixel wide, so a Line can't be thickened. The mesh belongs in the inertial
 * (camera-rotated) group, not in the spinning Earth.
 */
export function createOrbitPath() {
  const viewport = uniform(new Vector2(1, 1));
  // 1 to size the line by angle (XR), 0 to size it in pixels.
  const angularSizing = uniform(0);

  const toClip = cameraProjectionMatrix.mul(modelViewMatrix);
  const startRaw = toClip.mul(vec4(attribute("segmentStart", "vec3"), 1));
  const endRaw = toClip.mul(vec4(attribute("segmentEnd", "vec3"), 1));
  const start = mix(
    startRaw,
    endRaw,
    clamp(float(MIN_W).sub(startRaw.w).div(endRaw.w.sub(startRaw.w)), 0, 1)
  );
  const end = mix(
    endRaw,
    startRaw,
    clamp(float(MIN_W).sub(endRaw.w).div(startRaw.w.sub(endRaw.w)), 0, 1)
  );
  const a = select(startRaw.w.lessThan(MIN_W), start, startRaw);
  const b = select(endRaw.w.lessThan(MIN_W), end, endRaw);

  // The units the line is widened in: pixels on screen, or (in XR) the tangent of the view angle,
  // found through the projection's focal lengths. Both are per unit of normalized device coords.
  const isAngular = angularSizing.greaterThan(0.5);
  const focalLengths = vec2(
    cameraProjectionMatrix.mul(vec4(1, 0, 0, 0)).x,
    cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y
  );
  const unitsPerNdc = select(
    isAngular,
    vec2(1).div(focalLengths),
    viewport.mul(0.5)
  );
  const halfWidth = select(
    isAngular,
    float(Math.tan(ORBIT_PATH_WIDTH_XR_RAD / 2)),
    float(ORBIT_PATH_WIDTH_PX / 2)
  );

  // The segment's direction in those units, turned 90 degrees to get the side to widen toward.
  const along = b.xy.div(b.w).sub(a.xy.div(a.w)).mul(unitsPerNdc);
  const direction = along.div(max(length(along), 0.000001));
  const side = vec2(direction.y.negate(), direction.x);
  const clip = select(positionGeometry.x.greaterThan(0.5), b, a);
  const offset = side
    .mul(positionGeometry.y)
    .mul(halfWidth)
    .div(unitsPerNdc)
    .mul(clip.w);

  const material = new MeshBasicNodeMaterial({
    side: DoubleSide,
    // The line writes no depth, so it can't hide the satellites.
    depthWrite: false,
  });
  material.vertexNode = vec4(clip.xy.add(offset), clip.z, clip.w);
  material.colorNode = vec3(...ORBIT_PATH_COLOR);

  // Sized for the longest path, so a refresh never reallocates.
  const segmentBuffer = new InstancedInterleavedBuffer(
    new Float32Array(ORBIT_PATH_SEGMENTS * FLOATS_PER_ORBIT_SEGMENT),
    FLOATS_PER_ORBIT_SEGMENT
  ).setUsage(DynamicDrawUsage);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(STRIP_CORNERS, 3));
  geometry.setAttribute(
    "segmentStart",
    new InterleavedBufferAttribute(segmentBuffer, 3, 0)
  );
  geometry.setAttribute(
    "segmentEnd",
    new InterleavedBufferAttribute(segmentBuffer, 3, 3)
  );
  geometry.instanceCount = 0;

  const mesh = new Mesh(geometry, material);
  // Positions come from the shader, so the geometry's bounds mean nothing for culling.
  mesh.frustumCulled = false;
  mesh.visible = false;
  // Three.js sorts opaque objects by the depth of their geometry's center, which here is a
  // meaningless point that moves with the view. The line writes no depth, so if the Earth drew
  // after it, the Earth would paint over it. Drawing it later keeps the depth test correct.
  mesh.renderOrder = 1;

  let current: OrbitPath | null = null;

  /** Shows this path, or nothing for null. Only uploads when the path changes. */
  function setPath(path: OrbitPath | null) {
    if (path === current) return;
    current = path;
    const segmentCount = path
      ? writeOrbitSegments(path.points, segmentBuffer.array as Float32Array)
      : 0;
    mesh.visible = segmentCount > 0;
    if (segmentCount === 0) return;
    segmentBuffer.needsUpdate = true;
    geometry.instanceCount = segmentCount;
  }

  /** Per-frame uniforms: the drawing buffer size, and whether to size the line by angle (XR). */
  function update(
    viewportWidth: number,
    viewportHeight: number,
    useAngularSizing: boolean
  ) {
    viewport.value.set(viewportWidth, viewportHeight);
    angularSizing.value = useAngularSizing ? 1 : 0;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { mesh, setPath, update, dispose };
}
