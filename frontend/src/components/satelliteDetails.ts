import {
  positionAt,
  type PositionsSnapshot,
  type SatelliteInfo,
} from "../api/satellites";
import { sentenceCase } from "../format";
import { computeLiveState, type LiveState } from "./liveState";
import { DAY_MS } from "../constants";
import { getLaunchYear } from "../utilities";

/**
 * The satellite card's contents, shared by the page's card (SatelliteCard) and the XR card
 * (three/xr/satelliteCard), so both always show the same data.
 */

export function fmt(value: number, digits = 0) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Older element sets mean less accurate positions.
type AgeLevel = "fresh" | "aging" | "stale";

export function elementAge(epochMs: number, nowMs: number) {
  const days = (nowMs - epochMs) / DAY_MS;
  const text =
    days < 1
      ? `${fmt(Math.max(0, days * 24))} hours old`
      : `${fmt(days, 1)} days old`;
  const level: AgeLevel = days < 3 ? "fresh" : days < 7 ? "aging" : "stale";
  return { text, level };
}

/** Where the satellite is at `nowMs` from the latest snapshot, or null if it isn't in it. */
export function liveStateAt(
  snapshot: PositionsSnapshot | null,
  id: number,
  nowMs: number
): LiveState | null {
  const index = snapshot?.indexById.get(id);
  return snapshot && index !== undefined
    ? computeLiveState(positionAt(snapshot, index), snapshot.t, nowMs)
    : null;
}

export interface DetailMetric {
  label: string;
  value: string;
}

export interface DetailBadge {
  text: string;
  // "type" is the object type's highlighted badge; "plain" is the default look.
  tone: "type" | "plain";
}

export interface DetailSection {
  id: "live" | "orbit" | "data" | "elements";
  label: string;
  metrics: DetailMetric[];
}

export interface SatelliteDetails {
  name: string;
  subtitle: string;
  badges: DetailBadge[];
  // The element set's epoch and how old it is, shown at the top of the data section.
  epoch: DetailMetric;
  age: { text: string; level: AgeLevel };
  sections: DetailSection[];
}

export function satelliteDetails(
  satellite: SatelliteInfo,
  live: LiveState | null,
  nowMs: number
): SatelliteDetails {
  const launchYear = getLaunchYear(satellite);
  const badges: DetailBadge[] = [];
  if (satellite.object_type) {
    badges.push({ text: sentenceCase(satellite.object_type), tone: "type" });
  }
  if (satellite.rcs)
    badges.push({ text: sentenceCase(satellite.rcs), tone: "plain" });
  if (launchYear)
    badges.push({ text: `Launched ${launchYear}`, tone: "plain" });

  const data: DetailMetric[] = [];
  if (satellite.originator)
    data.push({ label: "Source", value: satellite.originator });
  data.push({ label: "Revolutions", value: fmt(satellite.rev_at_epoch) });

  return {
    name: satellite.name,
    subtitle: `NORAD ${satellite.id} · ${satellite.designator}`,
    badges,
    epoch: {
      label: "Epoch",
      value: `${new Date(satellite.epoch_ms).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    },
    age: elementAge(satellite.epoch_ms, nowMs),
    sections: [
      {
        id: "live",
        label: "Live position",
        metrics: [
          {
            label: "Altitude",
            value: live ? `${fmt(live.altitudeKm)} km` : "—",
          },
          {
            label: "Speed",
            value: live ? `${fmt(live.speedKmS, 1)} km/s` : "—",
          },
          {
            label: "Latitude",
            value: live
              ? `${fmt(Math.abs(live.latitudeDeg), 1)}° ${live.latitudeDeg >= 0 ? "N" : "S"}`
              : "—",
          },
          {
            label: "Longitude",
            value: live
              ? `${fmt(Math.abs(live.longitudeDeg), 1)}° ${live.longitudeDeg >= 0 ? "E" : "W"}`
              : "—",
          },
        ],
      },
      {
        id: "orbit",
        label: "Orbit",
        metrics: [
          { label: "Period", value: `${fmt(satellite.period_min, 1)} min` },
          {
            label: "Inclination",
            value: `${fmt(satellite.inclination_deg, 2)}°`,
          },
          { label: "Eccentricity", value: fmt(satellite.eccentricity, 3) },
          {
            label: "Mean motion",
            value: `${fmt(satellite.mean_motion, 2)} rev/day`,
          },
        ],
      },
      { id: "data", label: "Data", metrics: data },
      {
        id: "elements",
        label: "Orbital elements",
        metrics: [
          { label: "RA of asc. node", value: `${fmt(satellite.raan_deg, 2)}°` },
          {
            label: "Arg. of perigee",
            value: `${fmt(satellite.arg_perigee_deg, 2)}°`,
          },
          {
            label: "Mean anomaly",
            value: `${fmt(satellite.mean_anomaly_deg, 2)}°`,
          },
          { label: "BSTAR (drag)", value: satellite.bstar.toExponential(2) },
        ],
      },
    ],
  };
}
