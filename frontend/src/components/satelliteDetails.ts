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

/** Plain-language explanations for the parts of the card that aren't in satelliteDetails' data. */
export const CARD_HELP = {
  name: "The name this object goes by in the tracking catalog.",
  orbitDiagram:
    "A to-scale picture of the orbit. The dashed line is the path, the blue circle is Earth, and the ringed square is this object.",
  perigee: "The closest this object gets to Earth's surface.",
  apogee: "The farthest this object gets from Earth's surface.",
  age: "How old this data is. Older data gives a less accurate position. Green is under 3 days, yellow is under 7, and red is older.",
};

const OBJECT_TYPE_HELP: Record<string, string> = {
  PAYLOAD:
    "A spacecraft, like a satellite. It's the cargo a rocket carried to space.",
  "ROCKET BODY": "A used part of a rocket, left in orbit after launch.",
  DEBRIS: "Space junk, like a broken-off piece or a discarded part.",
  UNKNOWN: "Trackers haven't confirmed what this object is.",
};

const RADAR_SIZE_HELP: Record<string, string> = {
  SMALL:
    "How big this object looks to radar. Small means under 0.1 square meters.",
  MEDIUM:
    "How big this object looks to radar. Medium means 0.1 to 1 square meter.",
  LARGE: "How big this object looks to radar. Large means over 1 square meter.",
};

export interface DetailMetric {
  label: string;
  value: string;
  help: string;
}

export interface DetailBadge {
  text: string;
  help: string;
  // "type" is the object type's highlighted badge; "plain" is the default look.
  tone: "type" | "plain";
}

export interface DetailSection {
  id: "live" | "orbit" | "data" | "elements";
  label: string;
  help: string;
  metrics: DetailMetric[];
}

export interface SatelliteDetails {
  name: string;
  subtitle: string;
  // The subtitle's separate identifiers, each with its own explanation.
  identifiers: { text: string; help: string }[];
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
    badges.push({
      text: sentenceCase(satellite.object_type),
      help:
        OBJECT_TYPE_HELP[satellite.object_type] ??
        "The kind of object this is.",
      tone: "type",
    });
  }
  if (satellite.rcs)
    badges.push({
      text: sentenceCase(satellite.rcs),
      help:
        RADAR_SIZE_HELP[satellite.rcs] ?? "How big this object looks to radar.",
      tone: "plain",
    });
  if (launchYear)
    badges.push({
      text: `Launched ${launchYear}`,
      help: "The year this object went to space.",
      tone: "plain",
    });

  const data: DetailMetric[] = [];
  if (satellite.originator)
    data.push({
      label: "Source",
      value: satellite.originator,
      help: "Who tracked this object and published this data.",
    });
  data.push({
    label: "Revolutions",
    value: fmt(satellite.rev_at_epoch),
    help: "How many trips around Earth this object had made when this data was measured.",
  });

  const identifiers = [
    {
      text: `NORAD ${satellite.id}`,
      help: "This object's catalog number. Every tracked object in orbit has its own.",
    },
    {
      text: satellite.designator,
      help: "This object's international ID: its launch year, that year's launch number, and a letter for each piece from the launch.",
    },
  ];

  return {
    name: satellite.name,
    subtitle: identifiers.map((identifier) => identifier.text).join(" · "),
    identifiers,
    badges,
    epoch: {
      label: "Epoch",
      value: `${new Date(satellite.epoch_ms).toISOString().slice(0, 16).replace("T", " ")} UTC`,
      help: "The moment this data was measured. The app predicts positions forward from this time.",
    },
    age: elementAge(satellite.epoch_ms, nowMs),
    sections: [
      {
        id: "live",
        label: "Live position",
        help: "Where this object is right now, updated every second.",
        metrics: [
          {
            label: "Altitude",
            value: live ? `${fmt(live.altitudeKm)} km` : "—",
            help: "How high above the ground this object is.",
          },
          {
            label: "Speed",
            value: live ? `${fmt(live.speedKmS, 1)} km/s` : "—",
            help: "How fast this object is moving, in kilometers per second.",
          },
          {
            label: "Latitude",
            value: live
              ? `${fmt(Math.abs(live.latitudeDeg), 1)}° ${live.latitudeDeg >= 0 ? "N" : "S"}`
              : "—",
            help: "How far north or south of the equator this object is.",
          },
          {
            label: "Longitude",
            value: live
              ? `${fmt(Math.abs(live.longitudeDeg), 1)}° ${live.longitudeDeg >= 0 ? "E" : "W"}`
              : "—",
            help: "How far east or west this object is, measured from a line through Greenwich, England.",
          },
        ],
      },
      {
        id: "orbit",
        label: "Orbit",
        help: "The path this object follows around Earth.",
        metrics: [
          {
            label: "Period",
            value: `${fmt(satellite.period_min, 1)} min`,
            help: "How long one trip around Earth takes.",
          },
          {
            label: "Inclination",
            value: `${fmt(satellite.inclination_deg, 2)}°`,
            help: "How tilted the orbit is. 0° follows the equator, and 90° passes over the poles.",
          },
          {
            label: "Eccentricity",
            value: fmt(satellite.eccentricity, 3),
            help: "How stretched the orbit is. 0 is a perfect circle, and closer to 1 is a long oval.",
          },
          {
            label: "Mean motion",
            value: `${fmt(satellite.mean_motion, 2)} rev/day`,
            help: "How many times this object circles Earth each day.",
          },
        ],
      },
      {
        id: "data",
        label: "Tracking details",
        help: "Where this tracking data came from and how recent it is.",
        metrics: data,
      },
      {
        id: "elements",
        label: "Advanced orbit data",
        help: "The numbers that describe an orbit exactly. The app uses them to work out where this object is.",
        metrics: [
          {
            label: "RA of asc. node",
            value: `${fmt(satellite.raan_deg, 2)}°`,
            help: "Short for right ascension of the ascending node. It's the spot where the orbit crosses the equator heading north, measured against the stars.",
          },
          {
            label: "Arg. of perigee",
            value: `${fmt(satellite.arg_perigee_deg, 2)}°`,
            help: "Short for argument of perigee. It's where the orbit's lowest point is, measured along the orbit from the northbound equator crossing.",
          },
          {
            label: "Mean anomaly",
            value: `${fmt(satellite.mean_anomaly_deg, 2)}°`,
            help: "About how far around its orbit this object was when this data was measured. 0° is the lowest point, and 180° is the highest.",
          },
          {
            label: "BSTAR (drag)",
            value: satellite.bstar.toExponential(2),
            help: "How much the thin upper air slows this object down. Bigger numbers mean more drag.",
          },
        ],
      },
    ],
  };
}
