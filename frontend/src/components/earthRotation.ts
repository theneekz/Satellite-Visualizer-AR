import { daysSinceJ2000 } from "../utilities";

// The texture's prime meridian is off by a half-turn.
const TEXTURE_OFFSET_IN_RADIANS = Math.PI;
// The agreed upon ERA on J2000, in turns.
const ERA_AT_J2000_TURNS = 0.779057273264;
// The Earth turns slightly more than once per 24-hour day because it also
// moves along its orbit.
const ERA_TURNS_PER_DAY = 1.00273781191135448;

/**
 * How far Earth has turned from the GCRS X axis at `epochMs`. Uses the IAU 2000
 * Earth Rotation Angle (ERA) to get approx. radians.
 */
export function eraRadians(epochMs: number): number {
  const turns =
    ERA_AT_J2000_TURNS + ERA_TURNS_PER_DAY * daysSinceJ2000(epochMs);

  //  Keep only the current turn.
  const fraction = turns - Math.floor(turns);

  // Converts to radians.
  return 2 * Math.PI * fraction;
}

/** Rotation to apply to the Earth mesh so it is oriented correctly in GCRS. */
export function earthRotationAngle(epochMs: number): number {
  return eraRadians(epochMs) + TEXTURE_OFFSET_IN_RADIANS;
}
