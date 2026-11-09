import { useEffect, useRef } from "react";
import type {
  OrbitPath,
  PositionsSnapshot,
  SatelliteInfo,
} from "../api/satellites";
import { elementBuffers, packElements } from "../propagation/elements";
import type {
  PropagatorRequest,
  PropagatorResponse,
} from "../propagation/propagator.worker";

// The renderers move each satellite in a straight line between snapshots, which drifts about 5 m
// from its true orbit over this interval. A pass over the catalog takes ~50 ms in the
// worker on desktop, so this leaves it idle most of the time.
const PROPAGATION_INTERVAL_MS = 1000;
// A path covers a full revolution, so the satellite stays on the line between refreshes. Refreshes
// only need to follow the orbit's slow drift.
const ORBIT_PATH_REFRESH_MS = 60_000;

/**
 * Propagates every satellite in a worker every PROPAGATION_INTERVAL_MS and keeps the latest
 * snapshot in a ref (no React state, so no rerenders). Also keeps the selected satellite's next
 * revolution in a second ref.
 */
export function usePropagatedPositions(
  satellites: SatelliteInfo[],
  selectedId: number | null
) {
  const positionsRef = useRef<PositionsSnapshot | null>(null);
  const orbitPathRef = useRef<OrbitPath | null>(null);
  const selectedIdRef = useRef(selectedId);
  // Set while a worker is running.
  const requestOrbitPathRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    orbitPathRef.current = null;
    requestOrbitPathRef.current?.();
  }, [selectedId]);

  useEffect(() => {
    if (satellites.length === 0) return;

    const worker = new Worker(
      new URL("../propagation/propagator.worker.ts", import.meta.url),
      { type: "module" }
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let lastOrbitPathMs = -Infinity;

    function send(request: PropagatorRequest, transfer: Transferable[] = []) {
      worker.postMessage(request, transfer);
    }
    function requestSnapshot() {
      if (inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      send({ type: "propagate", timeMs: Date.now() });
    }

    function requestOrbitPath() {
      const id = selectedIdRef.current;
      if (id === null) return;
      lastOrbitPathMs = Date.now();
      send({ type: "path", id, timeMs: lastOrbitPathMs });
    }
    requestOrbitPathRef.current = requestOrbitPath;

    worker.onmessage = (event: MessageEvent<PropagatorResponse>) => {
      const response = event.data;
      if (response.type === "path") {
        // The selection may have changed while the worker was computing this path.
        if (response.id === selectedIdRef.current) {
          orbitPathRef.current = { id: response.id, points: response.points };
        }
        return;
      }
      inFlight = false;
      const { timeMs, ids, state } = response;
      const indexById = new Map<number, number>();
      for (let i = 0; i < ids.length; i++) indexById.set(ids[i], i);
      positionsRef.current = { t: timeMs, ids, state, indexById };
      // Refreshing from the snapshot reply means the path pauses and resumes with the snapshots.
      if (Date.now() - lastOrbitPathMs >= ORBIT_PATH_REFRESH_MS) {
        requestOrbitPath();
      }
      // Browsers delay timers in hidden tabs, so a snapshot can be minutes old when the tab
      // returns, and the straight-line step flies satellites off their orbits. Pause while
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
      // A worker error means no reply is coming. Clear the in-flight flag and keep the loop
      // going, or requestSnapshot() returns early forever and the snapshot goes stale.
      inFlight = false;
      if (!document.hidden)
        timer = setTimeout(requestSnapshot, PROPAGATION_INTERVAL_MS);
    };

    const elements = packElements(satellites);
    send({ type: "load", elements }, elementBuffers(elements));
    requestSnapshot();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(timer);
      requestOrbitPathRef.current = null;
      worker.terminate();
    };
  }, [satellites]);

  return { positionsRef, orbitPathRef };
}
