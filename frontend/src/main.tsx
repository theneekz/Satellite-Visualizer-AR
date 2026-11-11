import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installXREmulatorIfNeeded } from "./xrEmulator";
import { trackVisibleViewport } from "./visibleViewport";

// iOS Safari ignores user-scalable=no in the viewport tag, so cancel its pinch gesture here to
// keep the page from zooming. Touch events still fire, so the globe's own pinch keeps working.
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (e) => e.preventDefault(), {
    passive: false,
  });
}

// The fixed body in index.css stops most page scrolling, but iOS Safari can still shift the page
// to keep a focused field above the keyboard. Undo that shift once the field loses focus.
document.addEventListener("focusout", () => {
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
});

trackVisibleViewport();

// Must run before the globe asks which XR session modes are supported.
await installXREmulatorIfNeeded();

// Gate on VR rather than AR: Quest supports both, while Android phones offer only handheld AR,
// which the XR mode doesn't support. Checked before the first render so a headset never mounts
// the WebGPU globe only to swap it out.
const xrSupported =
  (await navigator.xr?.isSessionSupported("immersive-vr").catch(() => false)) ??
  false;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App xrSupported={xrSupported} />
  </StrictMode>
);
