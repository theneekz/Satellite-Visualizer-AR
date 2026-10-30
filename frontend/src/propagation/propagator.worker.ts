/**
 * Propagates every satellite with SGP4 (satellite.js) off the main thread, so a pass over the whole
 * catalog never delays a frame. usePropagatedPositions loads the orbital elements once, then asks
 * for a snapshot on an interval.
 */
import { json2satrec, propagate, type SatRec } from "satellite.js";
import { FLOATS_PER_SATELLITE } from "../api/satellites";
import type { OrbitalElements } from "./elements";

export type PropagatorRequest =
  // Replaces the satellites to propagate.
  | { type: "load"; elements: OrbitalElements }
  // Asks for every satellite's state at `timeMs` (Unix epoch milliseconds, UTC).
  | { type: "propagate"; timeMs: number };

/**
 * Every satellite SGP4 could propagate at `timeMs`, laid out like PositionsSnapshot: `ids[i]` is
 * the NORAD id whose TEME state is `state[i * 6 .. i * 6 + 6]`.
 */
export interface PropagatorResponse {
  timeMs: number;
  ids: Uint32Array<ArrayBuffer>;
  state: Float32Array<ArrayBuffer>;
}

let satrecs: SatRec[] = [];
// The NORAD id of satrecs[i].
let satrecIds = new Uint32Array(0);

self.onmessage = (event: MessageEvent<PropagatorRequest>) => {
  const request = event.data;
  if (request.type === "load") {
    satrecIds = request.elements.ids;
    satrecs = Array.from(satrecIds, (_, i) => toSatrec(request.elements, i));
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

function propagateAll(timeMs: number): PropagatorResponse {
  const date = new Date(timeMs);
  const ids = new Uint32Array(satrecs.length);
  const state = new Float32Array(satrecs.length * FLOATS_PER_SATELLITE);
  let n = 0;
  for (let i = 0; i < satrecs.length; i++) {
    // null when SGP4 fails, for example when an orbit has decayed.
    const result = propagate(satrecs[i], date);
    if (!result) continue;
    const { position, velocity } = result;
    if (!isFiniteVector(position) || !isFiniteVector(velocity)) continue;

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
    timeMs,
    ids: ids.slice(0, n),
    state: state.slice(0, n * FLOATS_PER_SATELLITE),
  };
}
