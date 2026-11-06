/**
 * Earth images shared by the WebGPU renderer (Globe.tsx) and the Three.js renderer
 * (three/GlobeThree.tsx). All three are NASA's Blue Marble Next Generation, January 2004, with
 * topography and bathymetry (public domain), resized from the 21600x10800 original.
 *
 * The globe draws its first frame with the small preview. Once the satellite data has loaded
 * and the browser is idle, it loads a sharp image and swaps it in, so the sharp image never
 * delays the first frame or the satellites.
 */
import { satellitesSettled } from "../api/satellites";
import earthPreviewUrl from "../assets/earth.webp";
import earth4kUrl from "../assets/earth-4k.webp";
import earth8kUrl from "../assets/earth-8k.webp";

/** 2048x1024, about 210 KB: small enough that it doesn't slow the first frame. */
export { earthPreviewUrl };

/**
 * The sharp image to swap in after the first frame. Desktops and headsets get the 8192x4096
 * image (about 2.3 MB, about 170 MB of GPU memory with mipmaps). Touch devices, which are
 * usually phones and tablets, get the 4096x2048 image (about 680 KB, about 43 MB of GPU
 * memory), because older phones can run out of GPU memory with 8K. A coarse pointer is only a
 * rough sign of a phone; it's a heuristic. Headsets can report a coarse pointer too, so XR mode
 * is checked first.
 */
export function sharpEarthUrl(xr: boolean) {
  if (xr) return earth8kUrl;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  return touch ? earth4kUrl : earth8kUrl;
}

/**
 * Resolves when it's a good time to start loading the sharp image: after the first satellite
 * request finishes and the browser has a moment with nothing else to do. Safari has no
 * requestIdleCallback, so it waits a short fixed time instead.
 */
export async function sharpEarthLoadTime() {
  await satellitesSettled;
  await new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => resolve(), { timeout: 2000 });
    } else {
      setTimeout(resolve, 500);
    }
  });
}

/**
 * Fetches and decodes an Earth image. The sharp image is fetched at low priority so it doesn't
 * compete with the satellite data, and createImageBitmap decodes it off the main thread.
 */
export async function loadEarthBitmap(
  url: string,
  priority: RequestPriority = "auto"
) {
  const response = await fetch(url, { priority });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }
  return createImageBitmap(await response.blob());
}
