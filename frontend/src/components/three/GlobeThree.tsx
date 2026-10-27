import { useEffect, useRef, useState, type RefObject } from "react";
import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  Euler,
  Group,
  Line,
  LineBasicNodeMaterial,
  LinearSRGBColorSpace,
  Matrix4,
  NoColorSpace,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  TextureLoader,
  Vector2,
  Vector3,
  WebGPURenderer,
  type Event,
  type Texture,
} from "three/webgpu";
import type { PositionsSnapshot, SatelliteInfo } from "../../api/satellites";
import { gmstRadians } from "../earthRotation";
import { sunDirection } from "../sun";
import { createEarth } from "./earth";
import { createSatellites } from "./satellites";
import {
  createXRSatelliteCard,
  type XRSatelliteCard,
} from "./xr/satelliteCard";
import type { FilterOptions, SatelliteFilters } from "../../filters";
import {
  createXRSatelliteList,
  type ListHit,
  type XRSatelliteList,
} from "./xr/satelliteList";
import {
  CLICK_MAX_MOVE_PX,
  DRAG_SENSITIVITY,
  FOLLOW_RATE,
  FOV_DEG,
  FRAMING_DISTANCE_FACTOR,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_SENSITIVITY,
  cameraDistance,
  canvasSize,
  clipPlanes,
  wrapAngle,
  zoomForDistance,
} from "../camera";
import earthTextureUrl from "../../assets/earth.jpg";

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
// The satellite card floats this far from the standing user, this far to the right of straight
// ahead, and turned to face them, with its center a little above the globe's.
const XR_CARD_DISTANCE_M = 1;
const XR_CARD_ANGLE_RAD = (40 * Math.PI) / 180;
const XR_CARD_HEIGHT_M = XR_GLOBE_HEIGHT_M + 0.05;
// The satellite list mirrors the card on the user's left, its center at the same height.
const XR_LIST_DISTANCE_M = 1;
const XR_LIST_ANGLE_RAD = (-40 * Math.PI) / 180;
const XR_LIST_HEIGHT_M = XR_CARD_HEIGHT_M;
// Full thumbstick deflection, with the ray on the list, scrolls it this many layout pixels per
// second (about 50 rows). The deflection is squared, so a light push scrolls slowly.
const XR_LIST_SCROLL_SPEED = 2000;
// The xr-standard gamepad index of the left controller's Y button, which toggles the list until
// the hand menu exists.
const XR_Y_BUTTON = 5;
// A trigger press whose grab point moves less than this angle (about 3 degrees, as seen from the
// controller) counts as a click, not a drag. Squeezing a trigger dips the controller a little.
const XR_CLICK_MAX_ANGLE_RAD = 0.05;
// While a panel is dragged, the dragging controller's thumbstick pushes it away or pulls it in,
// by this rate (like the zoom's), between these distances from the controller in meters.
const XR_PANEL_PUSH_SPEED = 1.5;
const XR_PANEL_MIN_DISTANCE_M = 0.3;
const XR_PANEL_MAX_DISTANCE_M = 4;

/**
 * The yaw and pitch that turn the point (sx, sy, sz), in the globe's unrotated frame, toward the
 * unit direction (vx, vy, vz). The rotation is rotationX(pitch) * rotationY(yaw), so the yaw is
 * chosen to give the point v's x component (rotating about X leaves x alone), then the pitch turns
 * it the rest of the way in the YZ plane. With v = +Z this reduces to yaw = atan2(-sx, sz) and
 * pitch = atan2(sy, hypot(sx, sz)). Yaw can only sweep the point's x within +-hypot(sx, sz), so a
 * point near the polar axis can't reach a direction far off to the side; the clamp then turns it
 * as close as this rotation allows.
 */
function aimAngles(
  sx: number,
  sy: number,
  sz: number,
  vx: number,
  vy: number,
  vz: number
): [number, number] {
  const length = Math.hypot(sx, sy, sz);
  const yaw =
    Math.atan2(sz, sx) -
    Math.acos(Math.min(1, Math.max(-1, (vx * length) / Math.hypot(sx, sz))));
  const uz = -sx * Math.sin(yaw) + sz * Math.cos(yaw);
  return [yaw, Math.atan2(sy, uz) - Math.atan2(vy, vz)];
}

// What a controller's ray points at on a panel, tagged with the panel.
type PanelHit =
  | ({ panel: "card" } & NonNullable<ReturnType<XRSatelliteCard["hitTest"]>>)
  | ({ panel: "list" } & ListHit);

/** What the XR list shows and how it changes the filters, which App owns. */
export interface XRListProps {
  // The filtered satellites, the unfiltered count, and whether they are still loading.
  satellites: SatelliteInfo[];
  totalCount: number;
  loading: boolean;
  filters: SatelliteFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (patch: Partial<SatelliteFilters>) => void;
  onFiltersReset: () => void;
}

/**
 * Three.js version of Globe, with the same props and behavior. WebGPURenderer uses WebGPU when
 * available and falls back to WebGL 2 otherwise; the label in the corner shows which one is live.
 *
 * With `xr`, the renderer is forced onto WebGL 2 (headset browsers lack WebGPU XR bindings) and
 * the page offers buttons to enter an immersive VR or AR (passthrough) session. In a session the
 * globe floats in the room: the thumbstick spins and zooms it, dragging with the trigger held turns
 * it, and a trigger click selects the satellite a controller points at.
 *
 * Scene graph, mirroring the WebGPU renderer's frames:
 *   scene
 *   ├─ stage  (identity on screen; places and scales the globe in the room in XR)
 *   │  └─ inertial  (rotated by the camera's yaw/pitch; TEME with Y as the polar axis)
 *   │     ├─ satellites  (positions computed in the vertex shader)
 *   │     └─ earth       (additionally spun about Y by Greenwich Mean Sidereal Time)
 *   ├─ card  (XR only; the satellite card's layer plane, or its mesh without layers)
 *   ├─ list  (XR only; the satellite list, likewise)
 *   └─ controllers  (XR only; posed by the headset)
 */
function GlobeThree({
  positionsRef,
  visibleIds,
  selectedId,
  selectedSatellite,
  xrList,
  onPresentingChange,
  onSelect,
  xr = false,
}: {
  positionsRef: RefObject<PositionsSnapshot | null>;
  // Only these satellites are drawn; null means all of them.
  visibleIds: Set<number> | null;
  selectedId: number | null;
  // The selected satellite's details, for the XR card.
  selectedSatellite: SatelliteInfo | null;
  // The XR satellite list's contents and filter controls.
  xrList: XRListProps;
  onSelect: (id: number | null) => void;
  // Offer immersive XR sessions (see above).
  xr?: boolean;
  // Told when an XR session starts and ends, so the page can unmount what the headset can't show.
  onPresentingChange?: (presenting: boolean) => void;
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
  const selectedSatelliteRef = useRef(selectedSatellite);
  const onSelectRef = useRef(onSelect);
  const visibleIdsRef = useRef(visibleIds);
  const xrListRef = useRef(xrList);
  useEffect(() => {
    xrListRef.current = xrList;
    selectedIdRef.current = selectedId;
    selectedSatelliteRef.current = selectedSatellite;
    onSelectRef.current = onSelect;
    visibleIdsRef.current = visibleIds;
  });

  useEffect(() => {
    onPresentingChange?.(presenting);
  }, [presenting, onPresentingChange]);

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

    // XR controllers: each shows a pointer ray. Pulling the trigger and turning the controller
    // drags the globe; a trigger click selects what the ray points at.
    const rayGeometry = new BufferGeometry().setFromPoints([
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -XR_RAY_LENGTH),
    ]);
    const rayMaterial = new LineBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    });
    const inputSources = new Map<Group, XRInputSource>();
    const inertialInverse = new Matrix4();
    const rayOrigin = new Vector3();
    const rayDirection = new Vector3();
    const headDirection = new Vector3();

    const grabPoint = new Vector3();
    const panelGrabPoint = new Vector3();
    const panelGrabOffset = new Vector3();
    const dragRight = new Vector3();
    const UP = new Vector3(0, 1, 0);
    const panelFacing = new Euler(0, 0, 0, "YXZ");

    // The controller dragging the globe. The grab point is where its ray was at the press, carried
    // at a fixed distance along the ray, so it follows both turning and moving the controller. The
    // pick is made at the press too: what the ray pointed at when the trigger went down is what a
    // click selects, even if the trigger pull dips the controller. Only one controller drags at a
    // time.
    let xrDrag: {
      controller: Group;
      distance: number;
      start: Vector3;
      last: Vector3;
      pickedId: number | null;
      moved: boolean;
    } | null = null;

    /** Where the controller's ray is the given distance out, in world space. */
    function pointOnRay(controller: Group, distance: number, target: Vector3) {
      controller.getWorldPosition(rayOrigin);
      rayDirection.set(0, 0, -1).transformDirection(controller.matrixWorld);
      return target.copy(rayOrigin).addScaledVector(rayDirection, distance);
    }

    // A trigger press that started on a panel, and what it pressed. The card acts on release if
    // the ray is still on that part, like a button on the page; the list handles its own presses.
    let panelPress: { controller: Group; hit: PanelHit } | null = null;
    // The controller dragging a panel by its grab bar. As with the globe, the grab point is carried
    // at a fixed distance along the ray; the panel turns to face the head and sits so the spot
    // grabbed (in the panel's own space) stays on it.
    let panelDrag: {
      controller: Group;
      object: Group;
      distance: number;
      local: Vector3;
    } | null = null;
    const raycaster = new Raycaster();

    /** What the controller's ray points at on the nearest panel, if anything. */
    function panelHit(controller: Group): PanelHit | null {
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction
        .set(0, 0, -1)
        .transformDirection(controller.matrixWorld);
      const onCard = card?.hitTest(raycaster) ?? null;
      const onList = list?.hitTest(raycaster) ?? null;
      if (onList && (!onCard || onList.distance < onCard.distance))
        return { panel: "list", ...onList };
      return onCard && { panel: "card", ...onCard };
    }

    function panelObject(panel: PanelHit["panel"]) {
      return panel === "card" ? card!.object : list!.object;
    }

    /** Closes or opens the list, dropping it if it is being dragged. */
    function setListOpen(open: boolean) {
      if (!list) return;
      if (!open && panelDrag?.object === list.object) panelDrag = null;
      if (!open && panelPress?.hit.panel === "list") panelPress = null;
      // Closing drops a press in progress on it.
      list.setOpen(open);
    }

    function handleXRSelectStart(event: Event & { target: Group }) {
      const controller = event.target;
      // Panels are in front of the globe, so they get the press first.
      const hit = panelHit(controller);
      if (hit?.region === "grab") {
        panelDrag = {
          controller,
          object: panelObject(hit.panel),
          distance: hit.distance,
          local: hit.local,
        };
        return;
      }
      if (hit) {
        // One panel press at a time; a press with the other controller replaces it.
        if (panelPress?.hit.panel === "list") list?.cancelPointer();
        panelPress = { controller, hit };
        if (hit.panel === "list") list!.pointerDown(hit);
        return;
      }
      controller.getWorldPosition(rayOrigin);
      // About the distance to the globe's near surface; the drag moves that surface.
      const distance = Math.max(
        0.1,
        rayOrigin.distanceTo(stage.position) - stage.scale.x
      );
      const start = pointOnRay(controller, distance, new Vector3());
      xrDrag = {
        controller,
        distance,
        start,
        last: start.clone(),
        pickedId: pickWithController(controller),
        moved: false,
      };
    }

    function handleXRSelectEnd(event: Event & { target: Group }) {
      if (panelDrag?.controller === event.target) {
        panelDrag = null;
        return;
      }
      if (panelPress?.controller === event.target) {
        const pressed = panelPress.hit;
        panelPress = null;
        const hit = panelHit(event.target);
        if (pressed.panel === "list") {
          list?.pointerUp(hit?.panel === "list" ? hit : null);
          return;
        }
        if (
          hit?.panel === "card" &&
          hit.region === "close" &&
          pressed.region === "close"
        ) {
          // Closing the card clears the selection, like its close button on the page.
          following = false;
          selectedIdRef.current = null;
          lastSelectedId = null;
          onSelectRef.current(null);
        }
        return;
      }
      if (xrDrag?.controller !== event.target) return;
      const { moved, pickedId } = xrDrag;
      xrDrag = null;
      if (moved) return;
      // Like a click: a hit turns the satellite toward the user, a miss clears the selection.
      if (pickedId !== null) following = true;
      selectedIdRef.current = pickedId;
      lastSelectedId = pickedId;
      onSelectRef.current(pickedId);
    }

    /**
     * Turns the globe by how far the grab point moved since the last frame, so the surface under
     * it roughly stays under it: moving the point by some distance along the surface is that over
     * the radius in globe rotation. The globe doesn't move until the press becomes a drag, so a
     * click never turns its target away from the ray.
     */
    function handleXRDrag() {
      if (!xrDrag) return;
      pointOnRay(xrDrag.controller, xrDrag.distance, grabPoint);
      if (!xrDrag.moved) {
        if (
          grabPoint.distanceTo(xrDrag.start) <
          XR_CLICK_MAX_ANGLE_RAD * xrDrag.distance
        )
          return;
        xrDrag.moved = true;
        // Dragging the globe hands control back to the user, as on screen. The drag starts here,
        // so the globe doesn't jump by the distance it took to get past the click threshold.
        following = false;
        xrDrag.last.copy(grabPoint);
        return;
      }
      // Sideways is measured across the line from the globe to the head, so it stays sideways
      // wherever the user stands; up is the room's up.
      dragRight
        .subVectors(camera.position, stage.position)
        .cross(UP)
        .negate()
        .normalize();
      const radius = stage.scale.x;
      const dx = grabPoint.x - xrDrag.last.x;
      const dy = grabPoint.y - xrDrag.last.y;
      const dz = grabPoint.z - xrDrag.last.z;
      // Moving right turns the near surface right; moving down turns it down.
      yaw += (dx * dragRight.x + dy * dragRight.y + dz * dragRight.z) / radius;
      pitch -= dy / radius;
      xrDrag.last.copy(grabPoint);
    }

    /**
     * Moves the panel with the controller dragging it. It turns to face the head, so it reads
     * squarely wherever it is put, even overhead or down low, but never rolls: its top and bottom
     * edges stay level, like a window.
     */
    function handlePanelDrag() {
      if (!panelDrag) return;
      pointOnRay(panelDrag.controller, panelDrag.distance, panelGrabPoint);
      // The camera holds the headset's pose from the last frame.
      const dx = camera.position.x - panelGrabPoint.x;
      const dy = camera.position.y - panelGrabPoint.y;
      const dz = camera.position.z - panelGrabPoint.z;
      // Yaw about the vertical, then pitch about the panel's level horizontal axis (Euler YXZ),
      // so its front (+Z) points at the head. Pitching about X by a turns +Z to (0, -sin a, cos a).
      panelFacing.set(
        -Math.atan2(dy, Math.hypot(dx, dz)),
        Math.atan2(dx, dz),
        0
      );
      const { object } = panelDrag;
      object.quaternion.setFromEuler(panelFacing);
      panelGrabOffset.copy(panelDrag.local).applyQuaternion(object.quaternion);
      object.position.subVectors(panelGrabPoint, panelGrabOffset);
    }

    /** The satellite the controller's ray points at, or null. */
    function pickWithController(controller: Group) {
      // The ray, from world space into inertial space, where the globe is the unit sphere.
      inertialInverse.copy(inertial.matrixWorld).invert();
      controller.getWorldPosition(rayOrigin).applyMatrix4(inertialInverse);
      rayDirection
        .set(0, 0, -1)
        .transformDirection(controller.matrixWorld)
        .transformDirection(inertialInverse);
      return satellites.pickRay(rayOrigin, rayDirection);
    }

    // Each controller's pointer ray, which is cut short where it meets a panel.
    const rays = new Map<Group, Line>();
    const controllers = [0, 1].map((index) => {
      const controller = renderer.xr.getController(index);
      const ray = new Line(rayGeometry, rayMaterial);
      rays.set(controller, ray);
      controller.add(ray);
      controller.addEventListener("connected", (e) =>
        inputSources.set(controller, e.data)
      );
      controller.addEventListener("disconnected", () =>
        inputSources.delete(controller)
      );
      controller.addEventListener("selectstart", handleXRSelectStart);
      controller.addEventListener("selectend", handleXRSelectEnd);
      scene.add(controller);
      return controller;
    });

    // Whether each controller's Y button was down last frame, so a press toggles the list once.
    const yButtonDown = new Map<Group, boolean>();

    /** The left controller's Y button opens and closes the list. */
    function handleButtons() {
      for (const [controller, source] of inputSources) {
        if (source.handedness !== "left") continue;
        const down = source.gamepad?.buttons[XR_Y_BUTTON]?.pressed ?? false;
        if (down && !yButtonDown.get(controller) && list)
          setListOpen(!list.isOpen());
        yButtonDown.set(controller, down);
      }
    }

    /**
     * Thumbstick input: left/right spins the globe, forward/back zooms it. A controller dragging
     * a panel pushes it away or pulls it in instead, and one pointing at the list scrolls it.
     */
    function handleThumbsticks(dt: number) {
      for (const [controller, source] of inputSources) {
        // xr-standard gamepads put the thumbstick on axes 2 and 3.
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 4) continue;
        const [x, y] = [axes[2], axes[3]];
        if (panelDrag?.controller === controller) {
          if (Math.abs(y) > XR_THUMBSTICK_DEADZONE) {
            panelDrag.distance = Math.min(
              XR_PANEL_MAX_DISTANCE_M,
              Math.max(
                XR_PANEL_MIN_DISTANCE_M,
                panelDrag.distance * Math.exp(-y * XR_PANEL_PUSH_SPEED * dt)
              )
            );
          }
          continue;
        }
        if (panelHit(controller)?.panel === "list") {
          if (Math.abs(y) > XR_THUMBSTICK_DEADZONE) {
            list!.scrollBy(y * Math.abs(y) * XR_LIST_SCROLL_SPEED * dt);
          }
          continue;
        }
        if (Math.abs(x) > XR_THUMBSTICK_DEADZONE) {
          yaw += x * XR_SPIN_SPEED * dt;
          following = false;
        }
        if (Math.abs(y) > XR_THUMBSTICK_DEADZONE) {
          zoomPercent = Math.min(
            XR_ZOOM_MAX_PERCENT,
            Math.max(
              ZOOM_MIN_PERCENT,
              zoomPercent * Math.exp(-y * XR_ZOOM_SPEED * dt)
            )
          );
        }
      }
    }

    // Whether this session shows panels as WebXR layers; the IWER emulator has none.
    let sessionUsesLayers = false;

    function handleSessionStart() {
      setPresenting(true);
      sessionUsesLayers =
        renderer.xr.getSession()?.enabledFeatures?.includes("layers") ?? false;
      card?.setUsesLayers(sessionUsesLayers);
      list?.setUsesLayers(sessionUsesLayers);
      setListOpen(true);
      // Passthrough AR needs a transparent background to show the room.
      const blend = renderer.xr.getSession()?.environmentBlendMode;
      scene.background = blend && blend !== "opaque" ? null : background;
      // The headset sets the camera's pose and projection; only the clip planes are ours.
      camera.near = 0.05;
      camera.far = XR_FAR_M;
    }

    // The XR satellite card, created once the renderer is initialized, and the satellite and second
    // it last showed.
    let card: XRSatelliteCard | null = null;
    let cardSatellite: SatelliteInfo | null = null;
    let cardSecond = -1;

    // The XR satellite list, created with the card.
    let list: XRSatelliteList | null = null;

    // What the list does when used; the frame loop picks up the selection and filters from props.
    const listCallbacks = {
      onSelect: (id: number) => onSelectRef.current(id),
      onClose: () => setListOpen(false),
      onFiltersChange: (patch: Partial<SatelliteFilters>) =>
        xrListRef.current.onFiltersChange(patch),
      onFiltersReset: () => xrListRef.current.onFiltersReset(),
    };

    /**
     * Keeps the card showing the selected satellite with its live position refreshed once a
     * second and the list showing the latest satellites and selection, cuts each controller's ray
     * short where it meets a panel, and highlights what the rays point at: rows, close buttons,
     * and grab bars, and a grab bar while dragged.
     */
    function updateXRPanels() {
      if (!card || !list) return;
      const listProps = xrListRef.current;
      list.setSatellites(
        listProps.satellites,
        listProps.totalCount,
        listProps.loading
      );
      list.setFilters(listProps.filters, listProps.filterOptions);
      list.setSelected(selectedIdRef.current);
      // A held press on the list follows the ray, for dragging the year slider.
      if (panelPress?.hit.panel === "list") {
        const hit = panelHit(panelPress.controller);
        list.pointerMove(hit?.panel === "list" ? hit : null);
      }
      const satellite = selectedSatelliteRef.current;
      if (satellite !== cardSatellite) {
        cardSatellite = satellite;
        card.show(satellite);
        cardSecond = -1;
      }
      const now = Date.now();
      const second = Math.floor(now / 1000);
      if (second !== cardSecond) {
        cardSecond = second;
        card.refresh(positionsRef.current, now);
      }
      let cardCloseHovered = false;
      let cardGrabHighlighted = panelDrag?.object === card.object;
      let listHovered: string | null = null;
      let listGrabHighlighted = panelDrag?.object === list.object;
      for (const controller of controllers) {
        const hit = inputSources.has(controller) ? panelHit(controller) : null;
        const distance =
          panelDrag?.controller === controller
            ? panelDrag.distance
            : hit?.distance;
        rays.get(controller)!.scale.z =
          distance !== undefined ? distance / XR_RAY_LENGTH : 1;
        if (hit?.panel === "card") {
          if (hit.region === "close") cardCloseHovered = true;
          if (hit.region === "grab") cardGrabHighlighted = true;
        } else if (hit?.panel === "list") {
          if (hit.region === "grab") listGrabHighlighted = true;
          else listHovered ??= hit.key;
        }
      }
      card.setCloseHovered(cardCloseHovered);
      card.setGrabHighlighted(cardGrabHighlighted);
      card.update();
      list.setHover(listHovered, listGrabHighlighted);
      list.update();
    }

    function handleSessionEnd() {
      setPresenting(false);
      xrDrag = null;
      panelPress = null;
      panelDrag = null;
      // Off the headset the page shows its own card.
      card?.show(null);
      cardSatellite = null;
      list?.setOpen(false);
      yButtonDown.clear();
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
          ?.requestSession(mode, {
            optionalFeatures: ["local-floor", "layers"],
          })
          .then((session) => renderer.xr.setSession(session))
          .catch((err: unknown) =>
            console.error(`Failed to start ${mode}:`, err)
          );
      };
      const modes: XRSessionMode[] = ["immersive-vr", "immersive-ar"];
      Promise.all(
        modes.map((mode) => navigator.xr?.isSessionSupported(mode) ?? false)
      )
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
      if (inXR) {
        handleButtons();
        handleThumbsticks(Math.min(frameDt, 0.1));
        handleXRDrag();
        handlePanelDrag();
      }

      // Selecting a satellite turns the camera so it is centered, then keeps it there as it
      // orbits until the user drags. On screen it is turned onto the +Z axis (toward the camera);
      // in XR it is turned toward the headset, so it sits at eye level wherever the user stands.
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
          // The stage never rotates, so the head's direction from the globe's center in world
          // space is also its direction in the globe's unrotated frame. The camera holds the
          // headset's pose from the last frame.
          if (inXR)
            headDirection
              .subVectors(camera.position, stage.position)
              .normalize();
          else headDirection.set(0, 0, 1);
          const [targetYaw, targetPitch] = aimAngles(
            sx,
            sy,
            sz,
            headDirection.x,
            headDirection.y,
            headDirection.z
          );
          // Exponential smoothing: eases in, and stays put once it arrives.
          const k = 1 - Math.exp(-Math.min(frameDt, 0.1) * FOLLOW_RATE);
          yaw += wrapAngle(targetYaw - yaw) * k;
          pitch += wrapAngle(targetPitch - pitch) * k;
          // Zoom out (never in) after a selection, eased in log space so large changes feel even.
          if (framing) {
            const minDistance =
              Math.hypot(sx, sy, sz) * FRAMING_DISTANCE_FACTOR;
            const frameZoom = Math.max(
              ZOOM_MIN_PERCENT,
              zoomForDistance(minDistance, camera.aspect)
            );
            const targetZoom = Math.min(zoomPercent, frameZoom);
            zoomPercent *= (targetZoom / zoomPercent) ** k;
            if (Math.abs(Math.log(targetZoom / zoomPercent)) < 0.01)
              framing = false;
          }
        }
      }

      // Euler order XYZ gives rotationX(pitch) * rotationY(yaw), the WebGPU renderer's model matrix.
      inertial.rotation.set(pitch, yaw, 0);

      if (inXR) {
        // The headset poses the camera; the zoom scales the globe instead.
        const radius = (XR_BASE_RADIUS_M * zoomPercent) / 100;
        stage.position.set(0, XR_GLOBE_HEIGHT_M, -(XR_SURFACE_GAP_M + radius));
        stage.scale.setScalar(radius);
        stage.updateMatrixWorld();
        updateEarth();
        updateXRPanels();
        // Layers are drawn into their own textures before the scene, which punches their holes.
        if (sessionUsesLayers) renderer.xr.renderLayers();
        renderer.render(scene, camera);
        return;
      }

      inertial.updateMatrixWorld();
      const distance = cameraDistance(zoomPercent, camera.aspect);
      camera.position.set(0, 0, distance);
      const { near, far } = clipPlanes(distance);
      camera.near = near;
      camera.far = far;
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
      earth.mesh.rotation.y = gmstRadians(simTimeMs);
      // The Sun is inertial like the satellites: the same TEME -> scene axis swap, then the
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
      if (xr) {
        // To the user's right on an arc around where they stand, turned about Y to face them.
        card = createXRSatelliteCard(
          renderer,
          new Vector3(
            XR_CARD_DISTANCE_M * Math.sin(XR_CARD_ANGLE_RAD),
            XR_CARD_HEIGHT_M,
            -XR_CARD_DISTANCE_M * Math.cos(XR_CARD_ANGLE_RAD)
          ),
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            -XR_CARD_ANGLE_RAD
          )
        );
        scene.add(card.object);
        list = createXRSatelliteList(
          renderer,
          new Vector3(
            XR_LIST_DISTANCE_M * Math.sin(XR_LIST_ANGLE_RAD),
            XR_LIST_HEIGHT_M,
            -XR_LIST_DISTANCE_M * Math.cos(XR_LIST_ANGLE_RAD)
          ),
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            -XR_LIST_ANGLE_RAD
          ),
          listCallbacks
        );
        scene.add(list.object);
      }
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
        controller.removeEventListener("selectstart", handleXRSelectStart);
        controller.removeEventListener("selectend", handleXRSelectEnd);
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
      card?.dispose();
      list?.dispose();
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
