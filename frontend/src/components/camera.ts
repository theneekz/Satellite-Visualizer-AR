/**
 * Camera and interaction tuning shared by the WebGPU renderer (Globe.tsx) and the Three.js
 * renderer (three/GlobeThree.tsx), so both behave the same. Distances are in Earth radii.
 */

export const FOV_DEG = 45;
// The camera's distance at zoomPercent 100. Higher zoom is closer; lower is farther.
export const BASE_DISTANCE = 3;
export const ZOOM_MIN_PERCENT = 1;
export const ZOOM_MAX_PERCENT = 300;
export const ZOOM_SENSITIVITY = 0.1;
export const DRAG_SENSITIVITY = 0.01;
// A press that moves less than this many pixels counts as a click, not a drag.
export const CLICK_MAX_MOVE_PX = 5;
// How quickly the camera turns toward a selected satellite (higher is snappier).
export const FOLLOW_RATE = 6;
// On selection, the camera zooms out (if needed) to at least this many times the satellite's
// distance from the globe's center. Following puts the satellite between the camera and the
// globe, so a closer camera would leave a far satellite behind it.
export const FRAMING_DISTANCE_FACTOR = 1.5;
// The far clip plane sits this far beyond the globe's center. The farthest catalogued object
// reaches about 84 (a 526,000 km apogee), so nothing gets clipped.
const FAR_MARGIN = 100;
// The canvas fills the window but never shrinks below a usable size (the page scrolls instead).
const MIN_CANVAS_PX = 480;

/** The canvas size: the window's, but at least MIN_CANVAS_PX on each side. */
export function canvasSize() {
  return {
    width: Math.max(MIN_CANVAS_PX, Math.floor(window.innerWidth)),
    height: Math.max(MIN_CANVAS_PX, Math.floor(window.innerHeight)),
  };
}

/**
 * The camera's distance from the globe's center. In a portrait window the width is the limiting
 * side, so the camera backs off to keep the whole globe in view.
 */
export function cameraDistance(zoomPercent: number, aspect: number) {
  return (BASE_DISTANCE * (100 / zoomPercent)) / Math.min(1, aspect);
}

/** The zoom that puts the camera `distance` from the globe's center (the inverse of cameraDistance). */
export function zoomForDistance(distance: number, aspect: number) {
  return (BASE_DISTANCE * 100) / (distance * Math.min(1, aspect));
}

/**
 * Clip planes that scale with the camera distance: far always reaches past the farthest object,
 * and near grows with it so depth precision stays fine enough to keep low satellites from
 * flickering against the globe when zoomed far out.
 */
export function clipPlanes(distance: number) {
  return { near: distance / 100, far: distance + FAR_MARGIN };
}

/** Wraps an angle difference into [-PI, PI] so the camera turns the short way around. */
export function wrapAngle(angle: number) {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}
