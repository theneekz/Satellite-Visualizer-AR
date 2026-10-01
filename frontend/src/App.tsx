import { useCallback, useEffect, useMemo, useState } from "react";
import { getSatellites, type SatelliteInfo } from "./api/satellites";
import Globe from "./components/Globe";
import SatelliteCard from "./components/SatelliteCard";
import SatelliteFilterBar from "./components/SatelliteFilterBar";
import SatelliteList from "./components/SatelliteList";
import {
  DEFAULT_FILTERS,
  filterSatellites,
  getFilterOptions,
  isFiltering,
  type SatelliteFilters,
} from "./filters";
import { usePositionsPolling } from "./hooks/usePositionsPolling";

function App() {
  const [satellites, setSatellites] = useState<SatelliteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<SatelliteFilters>(DEFAULT_FILTERS);
  const positionsRef = usePositionsPolling();

  useEffect(() => {
    const controller = new AbortController();
    getSatellites(controller.signal)
      .then(setSatellites)
      .catch((err) => {
        if (controller.signal.aborted) return;
        // A backend failure shouldn't take the globe down; show it without satellites.
        console.error("Failed to load satellites:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Merges a partial update, keeping the same state object when nothing actually changed so an
  // unchanged value doesn't trigger a re-filter.
  const patchFilters = useCallback((patch: Partial<SatelliteFilters>) => {
    setFilters((prev) =>
      (Object.entries(patch) as [keyof SatelliteFilters, unknown][]).every(
        ([key, value]) => prev[key] === value
      )
        ? prev
        : { ...prev, ...patch }
    );
  }, []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const filtered = useMemo(
    () => filterSatellites(satellites, filters),
    [satellites, filters]
  );
  // The set of ids the globe should draw; null when nothing is filtered.
  const visibleIds = useMemo(
    () => (isFiltering(filters) ? new Set(filtered.map((s) => s.id)) : null),
    [filtered, filters]
  );
  const filterOptions = useMemo(
    () => getFilterOptions(satellites),
    [satellites]
  );

  const selected = satellites.find((s) => s.id === selectedId) ?? null;

  return (
    <main>
      <SatelliteList
        satellites={filtered}
        totalCount={satellites.length}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
      >
        <SatelliteFilterBar
          filters={filters}
          options={filterOptions}
          onChange={patchFilters}
          onReset={resetFilters}
        />
      </SatelliteList>
      <Globe
        positionsRef={positionsRef}
        visibleIds={visibleIds}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selected && (
        <SatelliteCard
          satellite={selected}
          positionsRef={positionsRef}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

export default App;
