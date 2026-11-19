export const DAY_MS = 86400000;

export const EARTH_RADIUS_KM = 6378.137;

// Brightness multiplier for the Earth's night side. It stays below the 0.35 used at the edge of
// daylight, so the surface keeps getting darker as it moves away from the Sun.
export const EARTH_NIGHT_BRIGHTNESS = 0.2;

// Brightness multiplier for satellites inside the Earth's shadow.
export const SATELLITE_SHADOW_BRIGHTNESS = 0.3;

// Satellite colors (RGB, 0 to 1), indexed by ObjectType value (see
// shared/omm.proto), so the order must match the enum. The hues are from the
// Okabe-Ito palette, which stays distinct with common color blindness, and
// avoid the light blue of the selected satellite.
export const SATELLITE_TYPE_COLORS: readonly (readonly [
  number,
  number,
  number,
])[] = [
  [0.6, 0.6, 0.6], // UNSPECIFIED: gray
  [1, 0.85, 0.2], // PAYLOAD: yellow
  [0.9, 0.4, 0.1], // ROCKET_BODY: vermilion
  [0.8, 0.47, 0.65], // DEBRIS: reddish purple
];

// Sputnik 1, the earliest launch year in the catalog.
export const FIRST_LAUNCH_YEAR = 1957;

// Search typing waits this long after the last key before filtering.
export const SEARCH_DEBOUNCE_MS = 250;

export const CURRENT_YEAR = new Date().getUTCFullYear();

// Below this width the navigation is a bottom bar, and it stays out of the globe's way.
export const PHONE_QUERY = "(max-width: 600px)";
