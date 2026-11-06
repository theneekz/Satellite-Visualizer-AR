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
import SidePanel, { type XRControls } from "./components/SidePanel";
import {
  DEFAULT_FILTERS,
  filterSatellites,
  getFilterOptions,
  isFiltering,
  type SatelliteFilters,
} from "./filters";
import { usePropagatedPositions } from "./hooks/usePropagatedPositions";

// The XR globe is the Three.js globe on WebGL with buttons to enter VR/AR. Headsets get it
// automatically; elsewhere ?renderer=xr forces it (with the dev emulator) and ?renderer=three
// shows the Three.js globe without XR, to compare it with the hand-written WebGPU one. It is
// code-split, so the default page never downloads Three.js.
const GlobeThree = lazy(() => import("./components/three/GlobeThree"));
const RENDERER = new URLSearchParams(window.location.search).get("renderer");

interface AppProps {
  // Whether this device can run an immersive VR session, as checked before the first render.
  xrSupported: boolean;
}

function App({ xrSupported }: AppProps) {
  const useXR = xrSupported || RENDERER === "xr";
  const useThree = useXR || RENDERER === "three";
  const [satellites, setSatellites] = useState<SatelliteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<SatelliteFilters>(DEFAULT_FILTERS);
  // While an XR session runs, the headset shows its own list, so the page's isn't mounted.
  const [presentingXR, setPresentingXR] = useState(false);
  // How to enter VR or AR, once the XR globe knows which modes this device supports.
  const [xrControls, setXRControls] = useState<XRControls | null>(null);
  const handleXRModes = useCallback(
    (modes: XRSessionMode[], start: (mode: XRSessionMode) => void) =>
      setXRControls(modes.length > 0 ? { modes, start } : null),
    []
  );
  const positionsRef = usePropagatedPositions(satellites);

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
        <SidePanel xr={xrControls}>
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
        </SidePanel>
      )}
      {useThree ? (
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
            xr={useXR}
            onPresentingChange={setPresentingXR}
            onXRModesChange={handleXRModes}
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
