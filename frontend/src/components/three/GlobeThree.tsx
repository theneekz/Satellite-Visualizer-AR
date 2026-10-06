import { useEffect, useRef, useState, type RefObject } from "react";
import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  Group,
  Line,
  LineBasicNodeMaterial,
  LinearSRGBColorSpace,
  Matrix4,
  NoColorSpace,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  TextureLoader,
  Vector2,
  Vector3,
  WebGPURenderer,
  type Event,
  type Texture,
} from "three/webgpu";
import type { PositionsSnapshot } from "../../api/satellites";
import { eraRadians } from "../earthRotation";
import { sunDirection } from "../sun";
import { createEarth } from "./earth";
import { createSatellites } from "./satellites";
import earthTextureUrl from "../../assets/earth.jpg";

// Camera and interaction tuning, matching the WebGPU renderer (components/Globe.tsx).
const FOV_DEG = 45;
const BASE_DISTANCE = 3;
const ZOOM_MIN_PERCENT = 1;
const ZOOM_MAX_PERCENT = 300;
const ZOOM_SENSITIVITY = 0.1;
const DRAG_SENSITIVITY = 0.01;
// A press that moves less than this many pixels counts as a click, not a drag.
const CLICK_MAX_MOVE_PX = 5;
// How quickly the camera turns toward a selected satellite (higher is snappier).
const FOLLOW_RATE = 6;
// On selection, the camera zooms out (if needed) to at least this many times the satellite's
// distance from the globe's center. Following puts the satellite between the camera and the
// globe, so a closer camera would leave a far satellite behind it.
const FRAMING_DISTANCE_FACTOR = 1.5;
// The far clip plane sits this far (in Earth radii) beyond the globe's center. The farthest
// catalogued object reaches about 84 (a 526,000 km apogee), so nothing gets clipped.
const FAR_MARGIN = 100;
// The canvas fills the window but never shrinks below a usable size (the page scrolls instead).
const MIN_CANVAS_PX = 480;

// XR: the globe floats in front of a standing user at eye height (meters, in the local-floor
// reference space, where -Z is forward), with the Earth's radius XR_BASE_RADIUS_M at zoom 100%.
// Zooming grows the globe and pushes its center back so its near surface stays XR_SURFACE_GAP_M
// away; at the maximum zoom that gap is roughly the height of a low orbit (about 240 km).
const XR_GLOBE_HEIGHT_M = 1.3;
const XR_SURFACE_GAP_M = 0.95;
const XR_BASE_RADIUS_M = 0.25;
const XR_ZOOM_MAX_PERCENT = 10000;
// Full thumbstick deflection spins the globe this many radians per second, and zooms by this
// factor of e per second.
const XR_SPIN_SPEED = 1.5;
const XR_ZOOM_SPEED = 1.5;
// Far enough for geostationary orbits around the largest globe.
const XR_FAR_M = 1000;
const XR_THUMBSTICK_DEADZONE = 0.15;
// The controller pointer rays, in meters.
const XR_RAY_LENGTH = 5;

/** Wraps an angle difference into [-PI, PI] so the camera turns the short way around. */
function wrapAngle(angle: number) {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}

function canvasSize() {
  return {
    width: Math.max(MIN_CANVAS_PX, Math.floor(window.innerWidth)),
    height: Math.max(MIN_CANVAS_PX, Math.floor(window.innerHeight)),
  };
}

/**
 * Three.js version of Globe, with the same props and behavior. WebGPURenderer uses WebGPU when
 * available and falls back to WebGL 2 otherwise; the label in the corner shows which one is live.
 *
 * With `xr`, the renderer is forced onto WebGL 2 (headset browsers lack WebGPU XR bindings) and
 * the page offers buttons to enter an immersive VR or AR (passthrough) session. In a session the
 * globe floats in the room: the thumbstick spins and zooms it, and the trigger selects the
 * satellite a controller points at.
 *
 * Scene graph, mirroring the WebGPU renderer's frames:
 *   scene
 *   ├─ stage  (identity on screen; places and scales the globe in the room in XR)
 *   │  └─ inertial  (rotated by the camera's yaw/pitch; GCRS with Y as the polar axis)
 *   │     ├─ satellites  (positions computed in the vertex shader)
 *   │     └─ earth       (additionally spun about Y by the Earth Rotation Angle)
 *   └─ controllers  (XR only; posed by the headset)
 */
function GlobeThree({
  positionsRef,
  visibleIds,
  selectedId,
  onSelect,
  xr = false,
}: {
  positionsRef: RefObject<PositionsSnapshot | null>;
  // Only these satellites are drawn; null means all of them.
  visibleIds: Set<number> | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  // Offer immersive XR sessions (see above).
  xr?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The immersive modes this device supports, and whether a session is running.
  const [xrModes, setXrModes] = useState<XRSessionMode[]>([]);
  const [presenting, setPresenting] = useState(false);
  // Set by the render effect; the buttons call it straight from the click, which the browser
  // requires before it grants a session.
  const startXRRef = useRef<((mode: XRSessionMode) => void) | null>(null);

  // The render effect runs once, so it reads the latest props through refs.
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const visibleIdsRef = useRef(visibleIds);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    onSelectRef.current = onSelect;
    visibleIdsRef.current = visibleIds;
  });

  useEffect(() => {
    const container = containerRef.current!;
    let disposed = false;

    // Pixel ratio 1 and no MSAA, like the WebGPU renderer, so the two are compared like for like.
    // XR gets MSAA, since aliasing shimmers badly in a headset.
    const renderer = new WebGPURenderer({ antialias: xr, forceWebGL: xr });
    renderer.setPixelRatio(1);
    // Shade in display space like the WebGPU renderer (no sRGB conversion), so colors match.
    renderer.outputColorSpace = LinearSRGBColorSpace;
    // A fresh canvas per mount, removed on cleanup, so StrictMode's remount never shares a context.
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    container.appendChild(canvas);

    const scene = new Scene();
    const background = new Color(0.02, 0.02, 0.05);
    scene.background = background;
    const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    const stage = new Group();
    const inertial = new Group();
    stage.add(inertial);
    scene.add(stage);

    const satellites = createSatellites();
    inertial.add(satellites.mesh);
    let earth: ReturnType<typeof createEarth> | null = null;
    let map: Texture | null = null;

    function resize() {
      // The headset owns the drawing buffer size during a session.
      if (renderer.xr.isPresenting) return;
      const { width, height } = canvasSize();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();

    // Camera state: yaw spins the globe about its polar axis, pitch tilts it about the screen's
    // horizontal axis (neither is limited). zoomPercent 100 is the default distance.
    let yaw = 0;
    let pitch = 0;
    let zoomPercent = 100;
    // While true, the camera turns to keep the selected satellite centered.
    let following = false;
    // While true, the zoom eases out until the newly selected satellite is far enough in front of
    // the camera; cleared once it gets there or the user scrolls.
    let framing = false;
    let lastSelectedId: number | null = null;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    // Matrices from the most recent frame, used to match clicks to satellites.
    const mvp = new Matrix4();
    const drawingBufferSize = new Vector2();

    function handleClick(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      renderer.getDrawingBufferSize(drawingBufferSize);
      const x = ((e.clientX - rect.left) * drawingBufferSize.x) / rect.width;
      const y = ((e.clientY - rect.top) * drawingBufferSize.y) / rect.height;
      const id = satellites.pick(
        mvp,
        inertial.matrixWorld,
        camera.position.z,
        drawingBufferSize.x,
        drawingBufferSize.y,
        x,
        y
      );
      // Clicking a satellite (even the already selected one) re-centers on it; clicking empty
      // space clears the selection.
      if (id !== null) following = true;
      // The satellite is already on screen, so keep the zoom: marking the selection as seen
      // stops the frame loop from zooming out for it (that is only for list selections). The
      // ref is updated now too; otherwise frames before React re-renders still see the old
      // selection, treat it as a change, and swing the camera back toward it.
      selectedIdRef.current = id;
      lastSelectedId = id;
      framing = false;
      onSelectRef.current(id);
    }

    function handlePointerDown(e: PointerEvent) {
      dragging = true;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
      if (!dragging) return;
      // Dragging the globe hands control back to the user.
      if (
        Math.hypot(e.clientX - downX, e.clientY - downY) >= CLICK_MAX_MOVE_PX
      ) {
        following = false;
      }
      yaw += (e.clientX - lastX) * DRAG_SENSITIVITY;
      pitch += (e.clientY - lastY) * DRAG_SENSITIVITY;
      lastX = e.clientX;
      lastY = e.clientY;
    }

    function handlePointerCancel(e: PointerEvent) {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
    }

    function handlePointerUp(e: PointerEvent) {
      handlePointerCancel(e);
      if (
        Math.hypot(e.clientX - downX, e.clientY - downY) < CLICK_MAX_MOVE_PX
      ) {
        handleClick(e);
      }
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      framing = false;
      zoomPercent = Math.min(
        ZOOM_MAX_PERCENT,
        Math.max(ZOOM_MIN_PERCENT, zoomPercent - e.deltaY * ZOOM_SENSITIVITY)
      );
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("resize", resize);

    // XR controllers: each shows a pointer ray, and its trigger selects what it points at.
    const rayGeometry = new BufferGeometry().setFromPoints([
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -XR_RAY_LENGTH),
    ]);
    const rayMaterial = new LineBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const inputSources = new Map<Group, XRInputSource>();
    const inertialInverse = new Matrix4();
    const rayOrigin = new Vector3();
    const rayDirection = new Vector3();

    function handleXRSelect(event: Event & { target: Group }) {
      const controller = event.target;
      // The ray, from world space into inertial space, where the globe is the unit sphere.
      inertialInverse.copy(inertial.matrixWorld).invert();
      controller.getWorldPosition(rayOrigin).applyMatrix4(inertialInverse);
      rayDirection.set(0, 0, -1).transformDirection(controller.matrixWorld).transformDirection(inertialInverse);
      const id = satellites.pickRay(rayOrigin, rayDirection);
      // Like a click: a hit turns the satellite toward the user, a miss clears the selection.
      if (id !== null) following = true;
      selectedIdRef.current = id;
      lastSelectedId = id;
      onSelectRef.current(id);
    }

    const controllers = [0, 1].map((index) => {
      const controller = renderer.xr.getController(index);
      controller.add(new Line(rayGeometry, rayMaterial));
      controller.addEventListener("connected", (e) => inputSources.set(controller, e.data));
      controller.addEventListener("disconnected", () => inputSources.delete(controller));
      controller.addEventListener("select", handleXRSelect);
      scene.add(controller);
      return controller;
    });

    /** Thumbstick input: left/right spins the globe, forward/back zooms it. */
    function handleThumbsticks(dt: number) {
      for (const source of inputSources.values()) {
        // xr-standard gamepads put the thumbstick on axes 2 and 3.
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 4) continue;
        const [x, y] = [axes[2], axes[3]];
        if (Math.abs(x) > XR_THUMBSTICK_DEADZONE) {
          yaw += x * XR_SPIN_SPEED * dt;
          following = false;
        }
        if (Math.abs(y) > XR_THUMBSTICK_DEADZONE) {
          zoomPercent = Math.min(
            XR_ZOOM_MAX_PERCENT,
            Math.max(ZOOM_MIN_PERCENT, zoomPercent * Math.exp(-y * XR_ZOOM_SPEED * dt))
          );
        }
      }
    }

    function handleSessionStart() {
      setPresenting(true);
      // Passthrough AR needs a transparent background to show the room.
      const blend = renderer.xr.getSession()?.environmentBlendMode;
      scene.background = blend && blend !== "opaque" ? null : background;
      // The headset sets the camera's pose and projection; only the clip planes are ours.
      camera.near = 0.05;
      camera.far = XR_FAR_M;
    }

    function handleSessionEnd() {
      setPresenting(false);
      scene.background = background;
      stage.position.set(0, 0, 0);
      stage.scale.setScalar(1);
      // XR zooms further than the screen allows.
      zoomPercent = Math.min(zoomPercent, ZOOM_MAX_PERCENT);
      // The session left the camera in the headset's last pose.
      camera.quaternion.identity();
      resize();
    }

    if (xr) {
      renderer.xr.enabled = true;
      renderer.xr.addEventListener("sessionstart", handleSessionStart);
      renderer.xr.addEventListener("sessionend", handleSessionEnd);
      startXRRef.current = (mode) => {
        const current = renderer.xr.getSession();
        if (current) {
          current.end();
          return;
        }
        navigator.xr
          ?.requestSession(mode, { optionalFeatures: ["local-floor"] })
          .then((session) => renderer.xr.setSession(session))
          .catch((err: unknown) => console.error(`Failed to start ${mode}:`, err));
      };
      const modes: XRSessionMode[] = ["immersive-vr", "immersive-ar"];
      Promise.all(modes.map((mode) => navigator.xr?.isSessionSupported(mode) ?? false))
        .then((supported) => {
          if (!disposed) setXrModes(modes.filter((_, i) => supported[i]));
        })
        .catch(() => {});
    }

    // The simulated "now" the satellites are drawn at; the Earth and Sun use the same instant.
    let simTimeMs = Date.now();
    let lastFrameTime = performance.now();
    let lastSnapshot: PositionsSnapshot | null = null;
    let lastVisibleIds: Set<number> | null | undefined = undefined;
    const sunWorld = new Vector3();

    function frame() {
      const now = performance.now();
      const frameDt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      simTimeMs += frameDt * 1000;

      // Re-upload when a new poll arrives or the filter changes.
      const snapshot = positionsRef.current;
      const visible = visibleIdsRef.current;
      if (
        snapshot &&
        (snapshot !== lastSnapshot || visible !== lastVisibleIds)
      ) {
        lastSnapshot = snapshot;
        lastVisibleIds = visible;
        satellites.setPositions(snapshot, visible);
      }
      satellites.setSelected(selectedIdRef.current);
      const inXR = renderer.xr.isPresenting;
      satellites.setAngularSizing(inXR);
      renderer.getDrawingBufferSize(drawingBufferSize);
      satellites.update(simTimeMs, drawingBufferSize.x, drawingBufferSize.y);
      if (inXR) handleThumbsticks(Math.min(frameDt, 0.1));

      // Selecting a satellite turns the camera so it is centered, then keeps it there as it
      // orbits until the user drags. Rotating by (yaw, pitch) puts a point (sx, sy, sz) on the
      // +Z axis (toward the camera) when yaw = atan2(-sx, sz) and pitch = atan2(sy, hypot(sx, sz)).
      const selected = selectedIdRef.current;
      if (selected !== lastSelectedId) {
        lastSelectedId = selected;
        following = selected !== null;
        // In XR the zoom is the globe's size in the room, which the user sets.
        framing = following && !inXR;
      }
      if (following && selected !== null) {
        const target = satellites.scenePosition(selected);
        if (target) {
          const [sx, sy, sz] = target;
          // Exponential smoothing: eases in, and stays put once it arrives.
          const k = 1 - Math.exp(-Math.min(frameDt, 0.1) * FOLLOW_RATE);
          yaw += wrapAngle(Math.atan2(-sx, sz) - yaw) * k;
          pitch += wrapAngle(Math.atan2(sy, Math.hypot(sx, sz)) - pitch) * k;
          // Zoom out (never in) after a selection, eased in log space so large changes feel even.
          if (framing) {
            const minDistance = Math.hypot(sx, sy, sz) * FRAMING_DISTANCE_FACTOR;
            // Inverts the camera distance formula below.
            const frameZoom = Math.max(
              ZOOM_MIN_PERCENT,
              (BASE_DISTANCE * 100) / (minDistance * Math.min(1, camera.aspect))
            );
            const targetZoom = Math.min(zoomPercent, frameZoom);
            zoomPercent *= (targetZoom / zoomPercent) ** k;
            if (Math.abs(Math.log(targetZoom / zoomPercent)) < 0.01) framing = false;
          }
        }
      }

      // Euler order XYZ gives rotationX(pitch) * rotationY(yaw), the WebGPU renderer's model matrix.
      inertial.rotation.set(pitch, yaw, 0);

      if (inXR) {
        // The headset poses the camera; the zoom scales the globe instead. Following a satellite
        // turns it toward +Z, which here faces the user.
        const radius = (XR_BASE_RADIUS_M * zoomPercent) / 100;
        stage.position.set(0, XR_GLOBE_HEIGHT_M, -(XR_SURFACE_GAP_M + radius));
        stage.scale.setScalar(radius);
        stage.updateMatrixWorld();
        updateEarth();
        renderer.render(scene, camera);
        return;
      }

      inertial.updateMatrixWorld();
      // In a portrait window the width is the limiting side, so back off to keep the globe in view.
      const distance =
        (BASE_DISTANCE * (100 / zoomPercent)) / Math.min(1, camera.aspect);
      camera.position.set(0, 0, distance);
      // Clip planes scale with distance: far always reaches past the farthest object, and near
      // grows with it so depth precision keeps low satellites from flickering against the globe.
      camera.near = distance / 100;
      camera.far = distance + FAR_MARGIN;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      mvp
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(inertial.matrixWorld);

      updateEarth();
      renderer.render(scene, camera);
    }

    function updateEarth() {
      if (!earth) return;
      earth.mesh.rotation.y = eraRadians(simTimeMs);
      // The Sun is inertial like the satellites: the same GCRS -> scene axis swap, then the
      // camera rotation (but not the Earth's spin), into world space. The stage never rotates.
      const [x, y, z] = sunDirection(simTimeMs);
      earth.sunDirection.copy(
        sunWorld.set(x, z, -y).applyQuaternion(inertial.quaternion)
      );
    }

    async function init() {
      const loaded = await new TextureLoader().loadAsync(earthTextureUrl);
      if (!disposed) await renderer.init();
      if (disposed) {
        loaded.dispose();
        return;
      }
      map = loaded;
      map.colorSpace = NoColorSpace;
      map.wrapS = RepeatWrapping;
      map.wrapT = ClampToEdgeWrapping;
      earth = createEarth(map);
      inertial.add(earth.mesh);
      const live = renderer.backend as { isWebGPUBackend?: boolean };
      setBackend(live.isWebGPUBackend ? "WebGPU" : "WebGL 2");
      // setAnimationLoop (rather than requestAnimationFrame) is what WebXR sessions drive.
      renderer.setAnimationLoop(frame);
    }

    init().catch((err: unknown) => {
      if (!disposed) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to initialize the renderer."
        );
      }
    });

    return () => {
      disposed = true;
      startXRRef.current = null;
      renderer.xr.getSession()?.end();
      renderer.xr.removeEventListener("sessionstart", handleSessionStart);
      renderer.xr.removeEventListener("sessionend", handleSessionEnd);
      for (const controller of controllers) {
        controller.removeEventListener("select", handleXRSelect);
        scene.remove(controller);
      }
      rayGeometry.dispose();
      rayMaterial.dispose();
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheel);
      satellites.dispose();
      earth?.dispose();
      map?.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [positionsRef, xr]);

  if (error) {
    return <p>Renderer unavailable: {error}</p>;
  }

  return (
    <div ref={containerRef}>
      {backend && (
        <span className="renderer-backend">Three.js · {backend}</span>
      )}
      {xrModes.length > 0 && (
        <div className="xr-buttons">
          {presenting ? (
            <button onClick={() => startXRRef.current?.("immersive-vr")}>
              Exit XR
            </button>
          ) : (
            xrModes.map((mode) => (
              <button key={mode} onClick={() => startXRRef.current?.(mode)}>
                {mode === "immersive-ar" ? "Enter AR" : "Enter VR"}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default GlobeThree;
