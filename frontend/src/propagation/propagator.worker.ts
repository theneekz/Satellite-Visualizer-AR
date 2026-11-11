/**
 * Propagates every satellite with SGP4 (satellite.js) off the main thread, so a pass over the whole
 * catalog never delays a frame. usePropagatedPositions loads the orbital elements once, then asks
 * for a snapshot on an interval.
 */
import { json2satrec, propagate, type SatRec } from "satellite.js";
import {
  FLOATS_PER_SATELLITE,
  ORBIT_PATH_MAX_POINTS,
  ORBIT_PATH_SEGMENTS,
  type OrbitPath,
} from "../api/satellites";
import { EARTH_RADIUS_KM } from "../constants";
import type { OrbitalElements } from "./elements";

export type PropagatorRequest =
  // Replaces the satellites to propagate.
  | { type: "load"; elements: OrbitalElements }
  // Asks for every satellite's state at `timeMs` (Unix epoch milliseconds, UTC).
  | { type: "propagate"; timeMs: number }
  // Asks for one satellite's next revolution, starting at `timeMs`.
  | { type: "path"; id: number; timeMs: number };

/**
 * Every satellite SGP4 could propagate to a believable position at `timeMs`, laid out like PositionsSnapshot: `ids[i]` is
 * the NORAD id whose TEME state is `state[i * 6 .. i * 6 + 6]`.
 */
export interface PropagatorSnapshot {
  type: "snapshot";
  timeMs: number;
  ids: Uint32Array<ArrayBuffer>;
  state: Float32Array<ArrayBuffer>;
}

export type PropagatorResponse =
  PropagatorSnapshot | ({ type: "path" } & OrbitPath);

let satrecs: SatRec[] = [];
// The NORAD id of satrecs[i].
let satrecIds = new Uint32Array(0);
let satrecById = new Map<number, SatRec>();

self.onmessage = (event: MessageEvent<PropagatorRequest>) => {
  const request = event.data;
  if (request.type === "load") {
    satrecIds = request.elements.ids;
    satrecs = Array.from(satrecIds, (_, i) => toSatrec(request.elements, i));
    satrecById = new Map(satrecs.map((satrec, i) => [satrecIds[i], satrec]));
  } else if (request.type === "path") {
    const response = propagatePath(request.id, request.timeMs);
    self.postMessage(response, { transfer: [response.points.buffer] });
  } else {
    const response = propagateAll(request.timeMs);
    self.postMessage(response, {
      transfer: [response.ids.buffer, response.state.buffer],
    });
  }
};

function toSatrec(elements: OrbitalElements, i: number): SatRec {
  return json2satrec({
    NORAD_CAT_ID: elements.ids[i],
    EPOCH: new Date(elements.epochMs[i]).toISOString(),
    MEAN_MOTION: elements.meanMotion[i],
    ECCENTRICITY: elements.eccentricity[i],
    INCLINATION: elements.inclinationDeg[i],
    RA_OF_ASC_NODE: elements.raanDeg[i],
    ARG_OF_PERICENTER: elements.argPerigeeDeg[i],
    MEAN_ANOMALY: elements.meanAnomalyDeg[i],
    BSTAR: elements.bstar[i],
    // Required by the OMM type, but SGP4 never reads them, so the payload leaves them out.
    OBJECT_NAME: "",
    OBJECT_ID: "",
    ELEMENT_SET_NO: 0,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  });
}

function isFiniteVector(v: { x: number; y: number; z: number }) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Whether the last propagate() call on this satrec went past the point where SGP4's model decays.
 * SGP4 scales the semi-major axis by tempa^2, and drag takes tempa from 1 toward 0. Past 0 the
 * square grows again, so SGP4 returns radii of up to millions of km with no error.
 */
function isPastModelDecay(satrec: SatRec) {
  return satrec.tempa <= 0;
}

function propagatePath(
  id: number,
  startMs: number
): Extract<PropagatorResponse, { type: "path" }> {
  const satrec = satrecById.get(id);
  const points = new Float32Array(ORBIT_PATH_MAX_POINTS * 3);
  let n = 0;
  if (satrec) {
    // satrec.no is the mean motion in radians per minute.
    const stepMs = ((2 * Math.PI) / satrec.no / ORBIT_PATH_SEGMENTS) * 60_000;
    // Sample on a fixed grid of times, so points that two refreshes share land in exactly the same
    // place and the line doesn't shift when it is replaced.
    const firstStep = Math.floor(startMs / stepMs);
    for (let segment = 0; segment <= ORBIT_PATH_SEGMENTS; segment++) {
      let result;
      try {
        result = propagate(satrec, new Date((firstStep + segment) * stepMs));
      } catch {
        break;
      }
      // Stop at the first failure: skipping a sample would draw a false chord across the gap.
      if (
        !result ||
        !isFiniteVector(result.position) ||
        isPastModelDecay(satrec)
      )
        break;
      // The same TEME -> globe axis swap and scale the renderers apply to satellites.
      const { x, y, z } = result.position;
      points[n * 3] = x / EARTH_RADIUS_KM;
      points[n * 3 + 1] = z / EARTH_RADIUS_KM;
      points[n * 3 + 2] = -y / EARTH_RADIUS_KM;
      n++;
    }
  }
  return { type: "path", id, points: points.slice(0, n * 3) };
}

function propagateAll(timeMs: number): PropagatorSnapshot {
  const date = new Date(timeMs);
  const ids = new Uint32Array(satrecs.length);
  const state = new Float32Array(satrecs.length * FLOATS_PER_SATELLITE);
  let n = 0;
  for (let i = 0; i < satrecs.length; i++) {
    // null when SGP4 fails, for example when an orbit has decayed.
    // Catch per satellite: if the worker throws, the main thread never gets a reply, so one
    // bad orbit would stall every snapshot.
    let result;
    try {
      result = propagate(satrecs[i], date);
    } catch {
      continue;
    }
    if (!result) continue;
    const { position, velocity } = result;
    if (!isFiniteVector(position) || !isFiniteVector(velocity)) continue;
    if (isPastModelDecay(satrecs[i])) continue;

    const o = n * FLOATS_PER_SATELLITE;
    state[o] = position.x;
    state[o + 1] = position.y;
    state[o + 2] = position.z;
    state[o + 3] = velocity.x;
    state[o + 4] = velocity.y;
    state[o + 5] = velocity.z;
    ids[n] = satrecIds[i];
    n++;
  }
  return {
    type: "snapshot",
    timeMs,
    ids: ids.slice(0, n),
    state: state.slice(0, n * FLOATS_PER_SATELLITE),
  };
}
