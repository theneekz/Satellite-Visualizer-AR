import { useEffect, useRef } from "react";
import { getPositions, type PositionsSnapshot } from "../api/satellites";

const POLL_INTERVAL_MS = 30 * 1000;

/** Polls /positions and keeps the latest response in a ref (no React state, so no rerenders). */
export function usePositionsPolling() {
  const positionsRef = useRef<PositionsSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        positionsRef.current = await getPositions(controller.signal);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to poll positions:", err);
      }
      if (controller.signal.aborted) return;
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return positionsRef;
}
