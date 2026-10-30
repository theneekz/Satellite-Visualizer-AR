import { FLOATS_PER_SATELLITE } from "../api/satellites";
import { EARTH_RADIUS_KM } from "../constants";

/**
 * Satellite placement and picking shared by the WebGPU renderer (satellite.ts) and the Three.js
 * renderer (three/satellites.ts), so both draw and pick satellites the same way.
 */

export const SATELLITE_SIZE_PX = 12;
// A click selects the nearest satellite within this many pixels.
export const PICK_RADIUS_PX = 10;

/**
 * Writes satellite `index`'s position `dt` seconds after the snapshot into `out`, in globe units
 * (Earth radius = 1). `data` holds each satellite's TEME position and velocity (km, km/s). This is
 * the same straight-line step the vertex shaders compute. TEME has Z as the polar axis and the
 * globe uses Y, so the axes are rotated (no mirroring).
 */
export function scenePositionAt(
  data: ArrayLike<number>,
  index: number,
  dt: number,
  out: number[]
) {
  const o = index * FLOATS_PER_SATELLITE;
  out[0] = (data[o] + data[o + 3] * dt) / EARTH_RADIUS_KM;
  out[1] = (data[o + 2] + data[o + 5] * dt) / EARTH_RADIUS_KM;
  out[2] = -(data[o + 1] + data[o + 4] * dt) / EARTH_RADIUS_KM;
}

/**
 * Whether the segment from (ox, oy, oz) to (ox + dx, oy + dy, oz + dz) passes through the unit
 * globe at the origin, i.e. whether the globe hides its far end from its near end.
 */
export function segmentHitsGlobe(
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

const scratch = [0, 0, 0];

/**
 * The index of the satellite nearest canvas pixel (px, py) within PICK_RADIUS_PX, or -1 if none.
 * `mvp` and `model` are the column-major camera matrices the satellites were drawn with, and the
 * camera sits at (0, 0, cameraDistance). Satellites hidden behind the globe are skipped.
 */
export function pickNearest(
  data: ArrayLike<number>,
  count: number,
  dt: number,
  mvp: ArrayLike<number>,
  model: ArrayLike<number>,
  cameraDistance: number,
  viewportWidth: number,
  viewportHeight: number,
  px: number,
  py: number
): number {
  const m = mvp;
  const r = model;
  let best = -1;
  let bestDist2 = PICK_RADIUS_PX * PICK_RADIUS_PX;

  for (let i = 0; i < count; i++) {
    scenePositionAt(data, i, dt, scratch);
    const [x, y, z] = scratch;

    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) continue;
    const ndcX = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ndcY = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const dx = (ndcX * 0.5 + 0.5) * viewportWidth - px;
    const dy = (0.5 - ndcY * 0.5) * viewportHeight - py;
    const dist2 = dx * dx + dy * dy;
    if (dist2 >= bestDist2) continue;

    const wx = r[0] * x + r[4] * y + r[8] * z;
    const wy = r[1] * x + r[5] * y + r[9] * z;
    const wz = r[2] * x + r[6] * y + r[10] * z - cameraDistance;
    if (segmentHitsGlobe(0, 0, cameraDistance, wx, wy, wz)) continue;

    best = i;
    bestDist2 = dist2;
  }
  return best;
}
