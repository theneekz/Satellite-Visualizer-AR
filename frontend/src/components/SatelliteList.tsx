import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SatelliteInfo } from "../api/satellites";
import "./SatelliteList.css";

// Must match .satellite-list__item's height in SatelliteList.css.
const ROW_HEIGHT_PX = 34;

// Phones have too little room for the list beside the globe, so it starts collapsed there.
const NARROW_QUERY = "(max-width: 600px)";

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
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia(NARROW_QUERY).matches
  );
  return (
    <nav
      className={`satellite-list${collapsed ? " is-collapsed" : ""}`}
      aria-label="Satellites"
      aria-busy={loading}
    >
      <button
        type="button"
        className="satellite-list__toggle"
        aria-expanded={!collapsed}
        aria-controls="satellite-list-body"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="satellite-list__title">
          {loading
            ? "Satellites"
            : satellites.length === totalCount
              ? `Satellites (${totalCount})`
              : `Satellites (${satellites.length} of ${totalCount})`}
        </span>
        {/* A menu icon signals that the header opens and closes the list. */}
        <svg
          className="satellite-list__icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
        >
          <path
            d="M3 6h18M3 12h18M3 18h18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div
        id="satellite-list-body"
        className="satellite-list__body"
        hidden={collapsed}
      >
        <ListBody
          satellites={satellites}
          totalCount={totalCount}
          loading={loading}
          selectedId={selectedId}
          onSelect={onSelect}
        >
          {children}
        </ListBody>
      </div>
    </nav>
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
          Loading satellites...
        </p>
      ) : satellites.length === 0 ? (
        <p className="satellite-list__message">
          {totalCount > 0
            ? "No satellites match your filters."
            : "No satellites found."}
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
