import type { SatelliteInfo } from "./api/satellites";

export interface SatelliteFilters {
  query: string; // matches name or NORAD id
  objectType: string; // '' means any
  size: string; // '' means any
  yearFrom: number | null;
  yearTo: number | null;
}

export const DEFAULT_FILTERS: SatelliteFilters = {
  query: "",
  objectType: "",
  size: "",
  yearFrom: null,
  yearTo: null,
};

export interface FilterOptions {
  objectTypes: string[];
  sizes: string[];
}

const SIZE_ORDER = ["SMALL", "MEDIUM", "LARGE"];

// Records from sources without these fields count as UNKNOWN.
export const typeOf = (satellite: SatelliteInfo) =>
  satellite.object_type ?? "UNKNOWN";
export const sizeOf = (satellite: SatelliteInfo) => satellite.rcs ?? "UNKNOWN";

/** The launch year from the international designator (1998-067A -> 1998), or null. */
export function launchYear(satellite: SatelliteInfo): number | null {
  const match = /^(\d{4})-/.exec(satellite.designator);
  return match ? Number(match[1]) : null;
}

export function isFiltering(filters: SatelliteFilters) {
  return (
    filters.query !== "" ||
    filters.objectType !== "" ||
    filters.size !== "" ||
    filters.yearFrom !== null ||
    filters.yearTo !== null
  );
}

export function filterSatellites(
  satellites: SatelliteInfo[],
  filters: SatelliteFilters
): SatelliteInfo[] {
  if (!isFiltering(filters)) return satellites;

  const query = filters.query.toLowerCase();
  const { yearFrom, yearTo } = filters;

  return satellites.filter((satellite) => {
    if (
      query &&
      !satellite.name.toLowerCase().includes(query) &&
      !String(satellite.id).includes(query)
    ) {
      return false;
    }
    if (filters.objectType && typeOf(satellite) !== filters.objectType)
      return false;
    if (filters.size && sizeOf(satellite) !== filters.size) return false;
    if (yearFrom !== null || yearTo !== null) {
      // Satellites with an unparseable designator can't satisfy a year filter.
      const year = launchYear(satellite);
      if (year === null) return false;
      if (yearFrom !== null && year < yearFrom) return false;
      if (yearTo !== null && year > yearTo) return false;
    }
    return true;
  });
}

/** The values present in the data, for the filter dropdowns. */
export function getFilterOptions(satellites: SatelliteInfo[]): FilterOptions {
  const objectTypes = new Set<string>();
  const sizes = new Set<string>();
  for (const satellite of satellites) {
    objectTypes.add(typeOf(satellite));
    sizes.add(sizeOf(satellite));
  }
  const rank = (size: string) => {
    const i = SIZE_ORDER.indexOf(size);
    return i === -1 ? SIZE_ORDER.length : i;
  };
  return {
    objectTypes: [...objectTypes].sort(),
    sizes: [...sizes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
  };
}
