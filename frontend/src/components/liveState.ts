import type { SatellitePosition } from "../api/satellites";
import { eraRadians } from "./earthRotation";
import { EARTH_RADIUS_KM } from "../constants";

// WGS84 ellipsoid (EARTH_RADIUS_KM is its equatorial radius).
const FLATTENING = 1 / 298.257223563;
const ECCENTRICITY_SQUARED = FLATTENING * (2 - FLATTENING);

export interface LiveState {
  altitudeKm: number;
  speedKmS: number;
  latitudeDeg: number;
  longitudeDeg: number;
}

/**
 * Where a satellite is at `nowMs`, from its polled GCRS state at `snapshotMs`: a straight-line step
 * (the same one the renderer draws), then GCRS -> Earth-fixed via the Earth Rotation Angle.
 * Uses the same simplified Earth rotation as the globe, so it matches what is drawn.
 */
export function computeLiveState(
  position: SatellitePosition,
  snapshotMs: number,
  nowMs: number
): LiveState {
  const dt = (nowMs - snapshotMs) / 1000;
  const x = position.x + position.vx * dt;
  const y = position.y + position.vy * dt;
  const z = position.z + position.vz * dt;

  const era = eraRadians(nowMs);
  const xe = x * Math.cos(era) + y * Math.sin(era);
  const ye = -x * Math.sin(era) + y * Math.cos(era);

  const p = Math.hypot(xe, ye);
  let lat = Math.atan2(z, p * (1 - ECCENTRICITY_SQUARED));
  let altitude = 0;
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat);
    const n =
      EARTH_RADIUS_KM / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLat * sinLat);
    // Near the poles p/cos(lat) blows up, so switch to the z form there.
    altitude =
      Math.abs(lat) < Math.PI / 4
        ? p / Math.cos(lat) - n
        : z / sinLat - n * (1 - ECCENTRICITY_SQUARED);
    lat = Math.atan2(z, p * (1 - (ECCENTRICITY_SQUARED * n) / (n + altitude)));
  }

  return {
    altitudeKm: altitude,
    speedKmS: Math.hypot(position.vx, position.vy, position.vz),
    latitudeDeg: (lat * 180) / Math.PI,
    longitudeDeg: (Math.atan2(ye, xe) * 180) / Math.PI,
  };
}
