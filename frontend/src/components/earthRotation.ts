// The texture's prime meridian is at its horizontal center (u = 0.5), which is phi = PI on the
// sphere mesh, so the mesh needs a half-turn to put Greenwich on the GCRS X axis at ERA = 0.
const TEXTURE_PRIME_MERIDIAN_OFFSET = Math.PI

/**
 * The IAU 2000 Earth Rotation Angle (radians): how far Greenwich has turned from the GCRS X axis
 * at `epochMs` (Unix epoch milliseconds, UTC).
 *
 * Uses UT1 approximated by UTC (under a second of error, well under a degree of rotation).
 * Polar motion and nutation are ignored.
 */
export function eraRadians(epochMs: number): number {
  // Days since J2000.0 (JD 2451545.0), computed directly from epoch ms to keep precision.
  const daysSinceJ2000 = epochMs / 86400000 - 10957.5
  const turns = 0.779057273264 + 1.00273781191135448 * daysSinceJ2000
  const fraction = turns - Math.floor(turns)
  return 2 * Math.PI * fraction
}

/** Rotation (radians, about the polar axis) to apply to the Earth mesh so it is oriented correctly in GCRS. */
export function earthRotationAngle(epochMs: number): number {
  return eraRadians(epochMs) + TEXTURE_PRIME_MERIDIAN_OFFSET
}
