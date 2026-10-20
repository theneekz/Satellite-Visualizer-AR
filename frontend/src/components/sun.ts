import { daysSinceJ2000 } from "../utilities";

const DEG_TO_RAD = Math.PI / 180;
// The Sun's angle along its yearly path at J2000, measured from the March
// equinox, if the Earth's orbit were a circle traveled at constant speed.
const MEAN_LONGITUDE_AT_J2000_DEG = 280.46;
// 360° per 365.2422 days, one March equinox to the next.
const MEAN_LONGITUDE_CHANGE_PER_DAY_DEG = 0.9856474;
// How far the Earth has moved past its closest point to the Sun (perihelion).
const MEAN_ANOMALY_AT_J2000_DEG = 357.528;
// 360° per 365.2596 days, one perihelion to the next (the anomalistic year).
const MEAN_ANOMALY_CHANGE_PER_DAY_DEG = 0.9856003;
// The equation of center: corrects the circular estimate for the Earth's oval
// orbit, by up to about 1.9°. These are the first two terms of an infinite
// series.
const EQUATION_OF_CENTER_1_DEG = 1.915;
const EQUATION_OF_CENTER_2_DEG = 0.02;
// Tilt of the Earth's axis at J2000.
const EARTH_TILT_AT_J2000_DEG = 23.439;
// The tilt gets smaller mainly because other planets pull on the Earth.
const EARTH_TILT_CHANGE_PER_DAY_DEG = 0.0000004;

/**
 * Unit vector from Earth toward the Sun at `epochMs` for lighting. Uses the
 * same axes as the satellites: X toward the March equinox and Z toward the
 * north pole.
 *
 * Uses the Astronomical Almanac's low-precision solar position. The result
 * ignores precession (Earth's slow wobble) which shifts it by under a degree.
 */
export function sunDirection(epochMs: number): [number, number, number] {
  const days = daysSinceJ2000(epochMs);
  const meanLongitude =
    MEAN_LONGITUDE_AT_J2000_DEG + MEAN_LONGITUDE_CHANGE_PER_DAY_DEG * days;
  const meanAnomaly =
    (MEAN_ANOMALY_AT_J2000_DEG + MEAN_ANOMALY_CHANGE_PER_DAY_DEG * days) *
    DEG_TO_RAD;

  const eclipticLongitude =
    (meanLongitude +
      EQUATION_OF_CENTER_1_DEG * Math.sin(meanAnomaly) +
      EQUATION_OF_CENTER_2_DEG * Math.sin(2 * meanAnomaly)) *
    DEG_TO_RAD;
  const earthTilt =
    (EARTH_TILT_AT_J2000_DEG - EARTH_TILT_CHANGE_PER_DAY_DEG * days) *
    DEG_TO_RAD;

  // Places the Sun on a circle in the plane of the Earth's orbit, then tilts
  // that circle to line up with the Earth's equator.
  return [
    Math.cos(eclipticLongitude),
    Math.cos(earthTilt) * Math.sin(eclipticLongitude),
    Math.sin(earthTilt) * Math.sin(eclipticLongitude),
  ];
}
