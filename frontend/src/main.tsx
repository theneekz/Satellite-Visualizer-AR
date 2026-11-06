import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installXREmulatorIfNeeded } from "./xrEmulator";

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
