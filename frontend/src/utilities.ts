import type { SatelliteInfo } from "./api/satellites";

// The launch year from the international designator (1998-067A -> 1998), or null.
export function getLaunchYear(satellite: SatelliteInfo): number | null {
  const match = /^(\d{4})-/.exec(satellite.designator);
  return match ? Number(match[1]) : null;
}
