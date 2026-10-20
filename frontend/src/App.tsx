import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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

// ?renderer=three swaps in the Three.js globe to compare it with the hand-written WebGPU one, and
// ?renderer=xr is that globe on WebGL with buttons to enter VR/AR on a headset. It is
// code-split, so the default page never downloads Three.js.
const GlobeThree = lazy(() => import("./components/three/GlobeThree"));
const RENDERER = new URLSearchParams(window.location.search).get("renderer");
const USE_XR = RENDERER === "xr";
const USE_THREE = RENDERER === "three" || USE_XR;

function App() {
  const [satellites, setSatellites] = useState<SatelliteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<SatelliteFilters>(DEFAULT_FILTERS);
  // While an XR session runs, the headset shows its own list, so the page's isn't mounted.
  const [presentingXR, setPresentingXR] = useState(false);
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
  // The set of ids the globe should draw when filtered only.
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
      {!presentingXR && (
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
      )}
      {USE_THREE ? (
        <Suspense fallback={null}>
          <GlobeThree
            positionsRef={positionsRef}
            visibleIds={visibleIds}
            selectedId={selectedId}
            selectedSatellite={selected}
            xrList={{
              satellites: filtered,
              totalCount: satellites.length,
              loading,
              filters,
              filterOptions,
              onFiltersChange: patchFilters,
              onFiltersReset: resetFilters,
            }}
            onSelect={setSelectedId}
            xr={USE_XR}
            onPresentingChange={setPresentingXR}
          />
        </Suspense>
      ) : (
        <Globe
          positionsRef={positionsRef}
          visibleIds={visibleIds}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
      {/* A full reload, so each renderer starts from a clean GPU context. */}
      <a className="renderer-switch" href={USE_THREE ? "?" : "?renderer=three"}>
        {USE_THREE ? "Use WebGPU renderer" : "Use Three.js renderer"}
      </a>
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
