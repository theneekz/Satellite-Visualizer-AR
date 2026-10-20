import { useEffect, useState } from "react";
import {
  isFiltering,
  type FilterOptions,
  type SatelliteFilters,
} from "../filters";
import { sentenceCase } from "../format";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import "./SatelliteFilterBar.css";

const DEBOUNCE_MS = 250;

// Ignore partial input like "19" until it is a full four-digit year.
function parseYear(value: string) {
  return /^\d{4}$/.test(value.trim()) ? Number(value) : null;
}

/**
 * Search and filter controls. Typing is debounced so a burst of keystrokes causes one filter pass
 * (and one list render and one GPU upload) instead of one per keystroke; the dropdowns apply
 * immediately.
 */
function SatelliteFilterBar({
  filters,
  options,
  onChange,
  onReset,
}: {
  filters: SatelliteFilters;
  options: FilterOptions;
  onChange: (patch: Partial<SatelliteFilters>) => void;
  onReset: () => void;
}) {
  const [queryInput, setQueryInput] = useState(filters.query);
  // Start from the applied years, which the XR list may have set while this was unmounted.
  const [fromInput, setFromInput] = useState(
    filters.yearFrom?.toString() ?? ""
  );
  const [toInput, setToInput] = useState(filters.yearTo?.toString() ?? "");

  const query = useDebouncedValue(queryInput, DEBOUNCE_MS);
  const from = useDebouncedValue(fromInput, DEBOUNCE_MS);
  const to = useDebouncedValue(toInput, DEBOUNCE_MS);

  useEffect(() => onChange({ query: query.trim() }), [query, onChange]);
  useEffect(() => onChange({ yearFrom: parseYear(from) }), [from, onChange]);
  useEffect(() => onChange({ yearTo: parseYear(to) }), [to, onChange]);

  const active =
    isFiltering(filters) ||
    queryInput !== "" ||
    fromInput !== "" ||
    toInput !== "";

  function reset() {
    setQueryInput("");
    setFromInput("");
    setToInput("");
    onReset();
  }

  return (
    <div className="satellite-filters">
      <input
        type="search"
        className="satellite-filters__control"
        placeholder="Search name or ID"
        aria-label="Search by name or ID"
        value={queryInput}
        onChange={(e) => setQueryInput(e.target.value)}
      />
      <div className="satellite-filters__row">
        <label className="satellite-filters__field">
          Type
          <select
            className="satellite-filters__control"
            value={filters.objectType}
            onChange={(e) => onChange({ objectType: e.target.value })}
          >
            <option value="">All</option>
            {options.objectTypes.map((type) => (
              <option key={type} value={type}>
                {sentenceCase(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="satellite-filters__field">
          Size
          <select
            className="satellite-filters__control"
            value={filters.size}
            onChange={(e) => onChange({ size: e.target.value })}
          >
            <option value="">All</option>
            {options.sizes.map((size) => (
              <option key={size} value={size}>
                {sentenceCase(size)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="satellite-filters__row">
        <label className="satellite-filters__field">
          Launched from
          <input
            className="satellite-filters__control"
            inputMode="numeric"
            maxLength={4}
            placeholder="1957"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
          />
        </label>
        <label className="satellite-filters__field">
          To
          <input
            className="satellite-filters__control"
            inputMode="numeric"
            maxLength={4}
            placeholder="2026"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
          />
        </label>
      </div>
      {active && (
        <button
          type="button"
          className="satellite-filters__reset"
          onClick={reset}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

export default SatelliteFilterBar;
