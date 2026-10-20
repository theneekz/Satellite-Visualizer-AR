import { daysSinceJ2000 } from "../utilities";

/**
 * Unit vector from Earth toward the Sun at `epochMs` for lighting.
 *
 * Uses the Astronomical Almanac's low-precision solar position, which differs from GCRS only
 * by precession (Earth's slow wobble).
 */
export function sunDirection(epochMs: number): [number, number, number] {
  const n = daysSinceJ2000(epochMs);
  const deg = Math.PI / 180;

  const meanLongitude = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * deg;
  const eclipticLongitude =
    (meanLongitude +
      1.915 * Math.sin(meanAnomaly) +
      0.02 * Math.sin(2 * meanAnomaly)) *
    deg;
  const obliquity = (23.439 - 0.0000004 * n) * deg;

  return [
    Math.cos(eclipticLongitude),
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.sin(obliquity) * Math.sin(eclipticLongitude),
  ];
}
