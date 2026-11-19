import { fromBinary } from "@bufbuild/protobuf";
import { ObjectType, OMMListSchema, type OMM } from "../protos/omm_pb";

export { ObjectType };

/** One satellite state in TEME, SGP4's inertial frame: position in km, velocity in km/s. */
export interface SatellitePosition {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Static per-satellite info derived from the OMM record. */
export interface SatelliteInfo {
  id: number; // NORAD catalog id
  name: string;
  designator: string; // international designator, e.g. 1998-067A
  epoch_ms: number; // element set epoch, Unix epoch milliseconds (UTC)
  period_min: number;
  inclination_deg: number;
  eccentricity: number;
  perigee_km: number;
  apogee_km: number;
  mean_motion: number; // rev/day
  raan_deg: number;
  arg_perigee_deg: number;
  mean_anomaly_deg: number; // at epoch
  bstar: number;
  rev_at_epoch: number;
  // ObjectType.UNSPECIFIED when the type is unknown. Also the satellite's type
  // color index.
  object_type: ObjectType;
  rcs: string | null; // radar cross-section size bucket
  originator: string | null;
}

// Floats per satellite in the state block: position (3) + velocity (3).
export const FLOATS_PER_SATELLITE = 6;

/**
 * Every satellite's state at `t` (Unix epoch milliseconds, UTC), propagated in the browser by
 * usePropagatedPositions. `ids[i]` is the NORAD id whose TEME state (x, y, z km, vx, vy, vz km/s)
 * is `state[i * 6 .. i * 6 + 6]`.
 */
export interface PositionsSnapshot {
  t: number;
  ids: Uint32Array<ArrayBuffer>;
  state: Float32Array<ArrayBuffer>;
  indexById: Map<number, number>;
}

// Segments in one drawn revolution, evenly spaced in time. Satellites sweep fastest at perigee, so
// this is high enough to keep eccentric orbits smooth there.
export const ORBIT_PATH_SEGMENTS = 1440;
export const ORBIT_PATH_MAX_POINTS = ORBIT_PATH_SEGMENTS + 1;

/**
 * A satellite's next revolution. `points` holds x, y, z triples in globe units (Earth radius = 1,
 * inertial, Y as the polar axis). It ends early if SGP4 fails partway, for example on a decay.
 */
export interface OrbitPath {
  id: number;
  points: Float32Array<ArrayBuffer>;
}

/** The TEME state of the satellite at `index` in a snapshot. */
export function positionAt(
  snapshot: PositionsSnapshot,
  index: number
): SatellitePosition {
  const o = index * FLOATS_PER_SATELLITE;
  const s = snapshot.state;
  return {
    x: s[o],
    y: s[o + 1],
    z: s[o + 2],
    vx: s[o + 3],
    vy: s[o + 4],
    vz: s[o + 5],
  };
}

const SATELLITES_URL = "/v2/satellites";

// OMM's OBJECT_TYPE name for each type, which the filters and labels show.
// UNSPECIFIED shows as Unknown, like OMM's own UNKNOWN.
export const OBJECT_TYPE_NAMES: Record<ObjectType, string> = {
  [ObjectType.UNSPECIFIED]: "UNKNOWN",
  [ObjectType.PAYLOAD]: "PAYLOAD",
  [ObjectType.ROCKET_BODY]: "ROCKET BODY",
  [ObjectType.DEBRIS]: "DEBRIS",
};

// The deprecated OMM OBJECT_TYPE strings, for payloads published before the
// ObjectType enum.
const LEGACY_OBJECT_TYPES: Record<string, ObjectType> = {
  PAYLOAD: ObjectType.PAYLOAD,
  "ROCKET BODY": ObjectType.ROCKET_BODY,
  DEBRIS: ObjectType.DEBRIS,
};

/**
 * The satellite's type, always one this build knows, so it's a valid color
 * index. A value added to the proto after this build counts as UNSPECIFIED.
 * Payloads published before the enum only have the legacy string; remove that
 * fallback once every published payload has field 19.
 */
function objectTypeOf(omm: OMM): ObjectType {
  if (omm.objectType !== ObjectType.UNSPECIFIED) {
    return omm.objectType in OBJECT_TYPE_NAMES
      ? omm.objectType
      : ObjectType.UNSPECIFIED;
  }
  return (
    LEGACY_OBJECT_TYPES[omm.objectTypeLegacy ?? ""] ?? ObjectType.UNSPECIFIED
  );
}

/** Maps a decoded protobuf OMM onto the app's SatelliteInfo shape. */
function toSatelliteInfo(omm: OMM): SatelliteInfo {
  return {
    id: omm.id,
    name: omm.name,
    designator: omm.designator,
    // int64 decodes as bigint; Unix milliseconds fit exactly in a JS number.
    epoch_ms: Number(omm.epochMs),
    period_min: omm.periodMin,
    inclination_deg: omm.inclinationDeg,
    eccentricity: omm.eccentricity,
    perigee_km: omm.perigeeKm,
    apogee_km: omm.apogeeKm,
    mean_motion: omm.meanMotion,
    raan_deg: omm.raanDeg,
    arg_perigee_deg: omm.argPerigeeDeg,
    mean_anomaly_deg: omm.meanAnomalyDeg,
    bstar: omm.bstar,
    rev_at_epoch: omm.revAtEpoch,
    object_type: objectTypeOf(omm),
    // Unset proto3 optional fields decode as undefined.
    rcs: omm.rcs ?? null,
    originator: omm.originator ?? null,
  };
}

let markSatellitesSettled: () => void;
/**
 * Resolves once the first satellite request finishes, whether or not it succeeds. Large
 * downloads that can wait, like the sharp Earth image, wait for this so they don't compete with
 * the satellite data.
 */
export const satellitesSettled = new Promise<void>((resolve) => {
  markSatellitesSettled = resolve;
});

/**
 * Fetches the satellite catalog. Keep this a plain GET with no custom headers so it reuses the
 * response that index.html preloads.
 */
export async function getSatellites(
  signal?: AbortSignal
): Promise<SatelliteInfo[]> {
  try {
    const response = await fetch(SATELLITES_URL, { signal });
    if (!response.ok) {
      throw new Error(
        `GET /v2/satellites failed with status ${response.status}`
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return fromBinary(OMMListSchema, bytes).satellites.map(toSatelliteInfo);
  } finally {
    // An aborted request (for example, React remounting the app) isn't the real load.
    if (!signal?.aborted) markSatellitesSettled();
  }
}
