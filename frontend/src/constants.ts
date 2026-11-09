export const DAY_MS = 86400000;

export const EARTH_RADIUS_KM = 6378.137;

// Brightness multiplier for the Earth's night side. It stays below the 0.35 used at the edge of
// daylight, so the surface keeps getting darker as it moves away from the Sun.
export const EARTH_NIGHT_BRIGHTNESS = 0.2;

// Brightness multiplier for satellites inside the Earth's shadow.
export const SATELLITE_SHADOW_BRIGHTNESS = 0.3;

// Sputnik 1, the earliest launch year in the catalog.
export const FIRST_LAUNCH_YEAR = 1957;

// Search typing waits this long after the last key before filtering.
export const SEARCH_DEBOUNCE_MS = 250;

export const CURRENT_YEAR = new Date().getUTCFullYear();

// Below this width the navigation is a bottom bar, and it stays out of the globe's way.
export const PHONE_QUERY = "(max-width: 600px)";
