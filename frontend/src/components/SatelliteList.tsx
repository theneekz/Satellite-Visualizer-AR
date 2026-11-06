import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SatelliteInfo } from "../api/satellites";
import { formatCount } from "../format";
import "./SatelliteList.css";

// Must match .satellite-list__item's height in SatelliteList.css.
const ROW_HEIGHT_PX = 34;

function SatelliteList({
  satellites,
  totalCount,
  loading,
  selectedId,
  onSelect,
  children,
}: {
  satellites: SatelliteInfo[];
  // Size of the unfiltered list.
  totalCount: number;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  // Search and filter controls, shown above the rows.
  children?: ReactNode;
}) {
  return (
    <section
      className="satellite-list"
      aria-labelledby="satellite-list-title"
      aria-busy={loading}
    >
      <h2 id="satellite-list-title" className="satellite-list__title">
        Artificial space objects
        {!loading && (
          <span className="satellite-list__count">
            {satellites.length === totalCount
              ? formatCount(totalCount)
              : `${formatCount(satellites.length)} of ${formatCount(totalCount)}`}
          </span>
        )}
      </h2>
      <ListBody
        satellites={satellites}
        totalCount={totalCount}
        loading={loading}
        selectedId={selectedId}
        onSelect={onSelect}
      >
        {children}
      </ListBody>
    </section>
  );
}

function ListBody({
  satellites,
  totalCount,
  loading,
  selectedId,
  onSelect,
  children,
}: {
  satellites: SatelliteInfo[];
  totalCount: number;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  children?: ReactNode;
}) {
  // Only the rows in (or near) view are rendered, so the DOM stays small for any list size.
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: satellites.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 10,
  });

  // When a satellite is selected from the globe, bring its row into view. The row may not be
  // rendered, so scroll by index rather than via its element.
  useEffect(() => {
    if (selectedId === null) return;
    const index = satellites.findIndex((s) => s.id === selectedId);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [selectedId, satellites, virtualizer]);

  return (
    <>
      {children}
      {loading ? (
        <p className="satellite-list__message" role="status">
          Loading Artificial Space Objects...
        </p>
      ) : satellites.length === 0 ? (
        <p className="satellite-list__message">
          {totalCount > 0
            ? "No Artificial Space Objects match your filters."
            : "No Artificial Space Objects found."}
        </p>
      ) : (
        <div className="satellite-list__items" ref={scrollRef}>
          <ul
            className="satellite-list__rows"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const satellite = satellites[row.index];
              const selected = satellite.id === selectedId;
              return (
                <li
                  key={satellite.id}
                  className="satellite-list__row"
                  style={{ transform: `translateY(${row.start}px)` }}
                  aria-setsize={satellites.length}
                  aria-posinset={row.index + 1}
                >
                  <button
                    type="button"
                    className={`satellite-list__item${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => onSelect(satellite.id)}
                  >
                    <span className="satellite-list__name">
                      {satellite.name}
                    </span>
                    <span className="satellite-list__id">{satellite.id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

export default SatelliteList;
