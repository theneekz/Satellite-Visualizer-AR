import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Line,
  LineBasicNodeMaterial,
} from "three/webgpu";
import { ORBIT_PATH_MAX_POINTS, type OrbitPath } from "../../api/satellites";
import { ORBIT_PATH_COLOR } from "../satelliteScene";

/**
 * The selected satellite's orbit as a line. It belongs in the inertial (camera-rotated) group, not
 * in the spinning Earth.
 */
export function createOrbitPath() {
  // Sized for the longest path, so a refresh never reallocates.
  const positions = new BufferAttribute(
    new Float32Array(ORBIT_PATH_MAX_POINTS * 3),
    3
  ).setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", positions);

  const material = new LineBasicNodeMaterial({
    color: new Color(...ORBIT_PATH_COLOR),
    // The line writes no depth, so it can't hide the satellites.
    depthWrite: false,
  });
  const line = new Line(geometry, material);
  // The geometry's contents change, so its cached bounds mean nothing for culling.
  line.frustumCulled = false;
  line.visible = false;

  let current: OrbitPath | null = null;

  /** Shows this path, or nothing for null. Only uploads when the path changes. */
  function setPath(path: OrbitPath | null) {
    if (path === current) return;
    current = path;
    const pointCount = path ? path.points.length / 3 : 0;
    line.visible = pointCount >= 2;
    if (!path || !line.visible) return;
    (positions.array as Float32Array).set(path.points);
    positions.needsUpdate = true;
    geometry.setDrawRange(0, pointCount);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { line, setPath, dispose };
}
