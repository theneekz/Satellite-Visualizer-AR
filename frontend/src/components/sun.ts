/**
 * Unit vector from Earth toward the Sun at `epochMs` (Unix epoch milliseconds, UTC), in the same
 * inertial axes as the satellites (X toward the equinox, Z toward the north pole).
 *
 * Uses the Astronomical Almanac's low-precision solar position (about 0.01 degrees, fine for
 * lighting). It gives the direction in the equatorial frame of date, which differs from GCRS only
 * by precession (well under a degree), the same simplification the Earth rotation makes.
 */
export function sunDirection(epochMs: number): [number, number, number] {
  // Days since J2000.0 (JD 2451545.0).
  const n = epochMs / 86400000 - 10957.5
  const deg = Math.PI / 180

  const meanLongitude = 280.46 + 0.9856474 * n
  const meanAnomaly = (357.528 + 0.9856003 * n) * deg
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * deg
  const obliquity = (23.439 - 0.0000004 * n) * deg

  return [
    Math.cos(eclipticLongitude),
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.sin(obliquity) * Math.sin(eclipticLongitude),
  ]
}
