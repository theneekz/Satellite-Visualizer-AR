import { useEffect, useRef } from "react";
import type { PositionsSnapshot, SatelliteInfo } from "../api/satellites";
import { elementBuffers, packElements } from "../propagation/elements";
import type {
  PropagatorRequest,
  PropagatorResponse,
} from "../propagation/propagator.worker";

// Between snapshots, the renderers step each satellite along a gravity-curved path, which stays
// within tens of meters of its true orbit over this interval.
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
    let inFlight = false;

    function send(request: PropagatorRequest, transfer: Transferable[] = []) {
      worker.postMessage(request, transfer);
    }
    function requestSnapshot() {
      if (inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      send({ type: "propagate", timeMs: Date.now() });
    }

    worker.onmessage = (event: MessageEvent<PropagatorResponse>) => {
      inFlight = false;
      const { timeMs, ids, state } = event.data;
      const indexById = new Map<number, number>();
      for (let i = 0; i < ids.length; i++) indexById.set(ids[i], i);
      positionsRef.current = { t: timeMs, ids, state, indexById };
      // Browsers delay timers in hidden tabs, so a snapshot can be minutes old when the tab
      // returns, and stepping that far drifts satellites off their orbits. Pause while
      // hidden and propagate again as soon as the tab is visible.
      if (!document.hidden)
        timer = setTimeout(requestSnapshot, PROPAGATION_INTERVAL_MS);
    };
    function onVisibilityChange() {
      if (!document.hidden) requestSnapshot();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    worker.onerror = (event) => {
      console.error("Failed to propagate satellites:", event.message);
    };

    const elements = packElements(satellites);
    send({ type: "load", elements }, elementBuffers(elements));
    requestSnapshot();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(timer);
      worker.terminate();
    };
  }, [satellites]);

  return positionsRef;
}
