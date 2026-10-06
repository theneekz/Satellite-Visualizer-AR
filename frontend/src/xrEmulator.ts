/**
 * Dev-only WebXR emulation: on ?renderer=xr in a browser with no headset, installs Meta's
 * Immersive Web Emulation Runtime (IWER) as an emulated Quest 3, plus its on-page controls for
 * moving the headset and controllers. Real XR devices are left alone. Production builds drop this
 * module (and the emulator packages) entirely.
 */
export async function installXREmulatorIfNeeded() {
  if (!import.meta.env.DEV) return;
  if (new URLSearchParams(window.location.search).get("renderer") !== "xr") return;

  // Desktop Chrome has navigator.xr even with no headset, so ask whether it can actually run VR.
  const native = await navigator.xr?.isSessionSupported("immersive-vr").catch(() => false);
  if (native) return;

  const [{ XRDevice, metaQuest3 }, { DevUI }, { default: WebXRLayersPolyfill }] = await Promise.all([
    import("iwer"),
    import("@iwer/devui"),
    import("webxr-layers-polyfill"),
  ]);
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  // Emulate WebXR Layers too, so Three renders into projection-layer textures like on a real Quest.
  // Without them IWER's XRWebGLLayer reports a null framebuffer (draw to the canvas), which
  // Three's WebGL backend can't handle in XR. This is applied here rather than through IWER's
  // polyfillLayers option, which installs the polyfill and then overwrites its XRWebGLBinding
  // with IWER's own (which can't create projection layers).
  new WebXRLayersPolyfill();
  device.installDevUI(DevUI);
}
