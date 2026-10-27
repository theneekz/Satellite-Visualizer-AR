import { useEffect, useRef } from "react";
import type { PositionsSnapshot, SatelliteInfo } from "../api/satellites";
import { elementBuffers, packElements } from "../propagation/elements";
import type {
  PropagatorRequest,
  PropagatorResponse,
} from "../propagation/propagator.worker";

// The renderers move each satellite in a straight line between snapshots, which drifts a few km
// from its true orbit over this interval.
const PROPAGATION_INTERVAL_MS = 30 * 1000;

/**
 * Propagates every satellite in a worker every PROPAGATION_INTERVAL_MS and keeps the latest
 * snapshot in a ref (no React state, so no rerenders).
 */
export function usePropagatedPositions(satellites: SatelliteInfo[]) {
  const positionsRef = useRef<PositionsSnapshot | null>(null);

  useEffect(() => {
    if (satellites.length === 0) return;

    const worker = new Worker(
      new URL("../propagation/propagator.worker.ts", import.meta.url),
      { type: "module" }
    );
    let timer: ReturnType<typeof setTimeout> | undefined;

    function send(request: PropagatorRequest, transfer: Transferable[] = []) {
      worker.postMessage(request, transfer);
    }
    function requestSnapshot() {
      send({ type: "propagate", timeMs: Date.now() });
    }

    worker.onmessage = (event: MessageEvent<PropagatorResponse>) => {
      const { timeMs, ids, state } = event.data;
      const indexById = new Map<number, number>();
      for (let i = 0; i < ids.length; i++) indexById.set(ids[i], i);
      positionsRef.current = { t: timeMs, ids, state, indexById };
      timer = setTimeout(requestSnapshot, PROPAGATION_INTERVAL_MS);
    };
    worker.onerror = (event) => {
      console.error("Failed to propagate satellites:", event.message);
    };

    const elements = packElements(satellites);
    send({ type: "load", elements }, elementBuffers(elements));
    requestSnapshot();

    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [satellites]);

  return positionsRef;
}
