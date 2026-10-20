import type { SatelliteInfo } from "./api/satellites";
import { DAY_MS } from "./constants";

// The launch year from the international designator (1998-067A -> 1998), or null.
export function getLaunchYear(satellite: SatelliteInfo): number | null {
  const match = /^(\d{4})-/.exec(satellite.designator);
  return match ? Number(match[1]) : null;
}

// Days since the J2000.0 epoch (JD 2451545.0, 10957.5 days after the Unix epoch).
export function daysSinceJ2000(epochMs: number): number {
  return epochMs / DAY_MS - 10957.5;
}
