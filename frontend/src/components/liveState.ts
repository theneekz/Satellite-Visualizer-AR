import type { SatellitePosition } from "../api/satellites";
import { gmstRadians } from "./earthRotation";
import { EARTH_RADIUS_KM } from "../constants";
import { stepTeme } from "./satelliteScene";

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
 * Where a satellite is at `nowMs`, from its TEME state at `snapshotMs`: `stepTeme` (the same step
 * the renderers draw), then TEME -> Earth-fixed via Greenwich Mean Sidereal Time.
 * Uses the same Earth rotation as the globe, so it matches what is drawn.
 */
export function computeLiveState(
  position: SatellitePosition,
  snapshotMs: number,
  nowMs: number
): LiveState {
  const dt = (nowMs - snapshotMs) / 1000;
  const stepped = [0, 0, 0];
  stepTeme(
    position.x,
    position.y,
    position.z,
    position.vx,
    position.vy,
    position.vz,
    dt,
    stepped
  );
  const [x, y, z] = stepped;

  const gmst = gmstRadians(nowMs);
  const xe = x * Math.cos(gmst) + y * Math.sin(gmst);
  const ye = -x * Math.sin(gmst) + y * Math.cos(gmst);

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
