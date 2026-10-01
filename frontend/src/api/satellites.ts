import { fromBinary } from "@bufbuild/protobuf";
import { OMMListSchema, type OMM } from "../protos/omm_pb";

/** One satellite state in the GCRS inertial frame: position in km, velocity in km/s. */
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
  object_type: string | null; // PAYLOAD, ROCKET BODY, DEBRIS, UNKNOWN; absent in some sources
  rcs: string | null; // radar cross-section size bucket
  originator: string | null;
}

// Floats per satellite in the state block: position (3) + velocity (3).
export const FLOATS_PER_SATELLITE = 6;
// Bytes per satellite in a /v2/positions response: a uint32 id + 6 float32s.
const BYTES_PER_SATELLITE = 4 + FLOATS_PER_SATELLITE * 4;

/**
 * Response of GET /v2/positions, computed at `t` (Unix epoch milliseconds, UTC). `ids[i]` is the
 * NORAD id whose GCRS state (x, y, z km, vx, vy, vz km/s) is `state[i * 6 .. i * 6 + 6]`.
 */
export interface PositionsSnapshot {
  t: number;
  ids: Uint32Array<ArrayBuffer>;
  state: Float32Array<ArrayBuffer>;
  indexById: Map<number, number>;
}

/** The GCRS state of the satellite at `index` in a snapshot. */
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

const SATELLITES_URL = "http://localhost:8000/v2/satellites";
const POSITIONS_URL = "http://localhost:8000/v2/positions";

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
    // Unset proto3 optional fields decode as undefined.
    object_type: omm.objectType ?? null,
    rcs: omm.rcs ?? null,
    originator: omm.originator ?? null,
  };
}

export async function getSatellites(
  signal?: AbortSignal
): Promise<SatelliteInfo[]> {
  const response = await fetch(SATELLITES_URL, { signal });
  if (!response.ok) {
    throw new Error(`GET /v2/satellites failed with status ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return fromBinary(OMMListSchema, bytes).satellites.map(toSatelliteInfo);
}

export async function getPositions(
  signal?: AbortSignal
): Promise<PositionsSnapshot> {
  const response = await fetch(POSITIONS_URL, { signal });
  if (!response.ok) {
    throw new Error(`GET /v2/positions failed with status ${response.status}`);
  }
  const t = Number(response.headers.get("X-Timescale"));
  const buffer = await response.arrayBuffer();
  const n = buffer.byteLength / BYTES_PER_SATELLITE;
  const ids = new Uint32Array(buffer, 0, n);
  const state = new Float32Array(buffer, n * 4, n * FLOATS_PER_SATELLITE);

  const indexById = new Map<number, number>();
  for (let i = 0; i < n; i++) indexById.set(ids[i], i);

  return { t, ids, state, indexById };
}
