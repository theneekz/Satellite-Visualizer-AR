import { gstime } from "satellite.js";

// The texture's prime meridian is off by a half-turn.
const TEXTURE_OFFSET_IN_RADIANS = Math.PI;

/**
 * How far Earth has turned from the TEME X axis at `epochMs`, in radians: Greenwich Mean Sidereal
 * Time (GMST). SGP4's TEME frame is defined by this GMST model, so using satellite.js's keeps each
 * satellite over the right ground. UTC stands in for UT1, which is less than a second off.
 */
export function gmstRadians(epochMs: number): number {
  return gstime(new Date(epochMs));
}

/** Rotation to apply to the Earth mesh so it is oriented correctly in TEME. */
export function earthRotationAngle(epochMs: number): number {
  return gmstRadians(epochMs) + TEXTURE_OFFSET_IN_RADIANS;
}
