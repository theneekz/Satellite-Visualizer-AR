import type { SatelliteInfo } from "../api/satellites";

/**
 * Every satellite's SGP4 inputs, one typed array per field (index i is satellite i), so they can be
 * transferred to the propagation worker without copying.
 */
export interface OrbitalElements {
  ids: Uint32Array<ArrayBuffer>; // NORAD catalog id
  epochMs: Float64Array<ArrayBuffer>; // element set epoch, Unix epoch milliseconds (UTC)
  meanMotion: Float64Array<ArrayBuffer>; // rev/day
  eccentricity: Float64Array<ArrayBuffer>;
  inclinationDeg: Float64Array<ArrayBuffer>;
  raanDeg: Float64Array<ArrayBuffer>;
  argPerigeeDeg: Float64Array<ArrayBuffer>;
  meanAnomalyDeg: Float64Array<ArrayBuffer>; // at epoch
  bstar: Float64Array<ArrayBuffer>;
}

export function packElements(satellites: SatelliteInfo[]): OrbitalElements {
  const n = satellites.length;
  const elements: OrbitalElements = {
    ids: new Uint32Array(n),
    epochMs: new Float64Array(n),
    meanMotion: new Float64Array(n),
    eccentricity: new Float64Array(n),
    inclinationDeg: new Float64Array(n),
    raanDeg: new Float64Array(n),
    argPerigeeDeg: new Float64Array(n),
    meanAnomalyDeg: new Float64Array(n),
    bstar: new Float64Array(n),
  };
  satellites.forEach((satellite, i) => {
    elements.ids[i] = satellite.id;
    elements.epochMs[i] = satellite.epoch_ms;
    elements.meanMotion[i] = satellite.mean_motion;
    elements.eccentricity[i] = satellite.eccentricity;
    elements.inclinationDeg[i] = satellite.inclination_deg;
    elements.raanDeg[i] = satellite.raan_deg;
    elements.argPerigeeDeg[i] = satellite.arg_perigee_deg;
    elements.meanAnomalyDeg[i] = satellite.mean_anomaly_deg;
    elements.bstar[i] = satellite.bstar;
  });
  return elements;
}

/** The buffers to transfer with `elements`. Transferring empties the sender's arrays. */
export function elementBuffers(elements: OrbitalElements): ArrayBuffer[] {
  return Object.values(elements).map((array) => array.buffer);
}
