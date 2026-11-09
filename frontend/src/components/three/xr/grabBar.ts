import {
  Plane,
  Quaternion,
  Vector3,
  type Raycaster,
  type WebGPURenderer,
} from "three/webgpu";
import { createCanvasLayer } from "./canvasLayer";
import {
  GRAB_GAP,
  GRAB_HEIGHT,
  GRAB_WIDTH,
  METERS_PER_PIXEL,
  PIXEL_RATIO,
  drawGrabBar,
  isOnGrabBar,
} from "./panelStyle";

/**
 * A panel's grab bar on its own layer, sized to the pill alone. A layer's plane punches a hole
 * through the scene wherever the layer is transparent, so keeping the bar off the panel's layer,
 * and its own layer no bigger than the pill, avoids transparent gaps. The bar is a child of the
 * panel's `object`, so it moves with the panel when dragged. Its hit area is wider than the pill,
 * so `hitTest` intersects the ray with the bar's plane instead of the layer's.
 */
export function createGrabBar(renderer: WebGPURenderer, panelWidth: number) {
  let highlighted = false;
  let visible = false;

  const layer = createCanvasLayer(renderer, {
    width: GRAB_WIDTH,
    height: GRAB_HEIGHT,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    // The pose comes from the parent panel; `placeBelow` sets the offset.
    position: new Vector3(),
    quaternion: new Quaternion(),
    draw: (ctx) => drawGrabBar(ctx, highlighted),
  });
  const { object } = layer;

  /**
   * Moves the bar under a panel drawn `panelHeight` layout pixels tall, whose layer is
   * `panelLayerHeight` tall and centered on the panel's object.
   */
  function placeBelow(panelHeight: number, panelLayerHeight: number) {
    // Layout pixels are y-down from the layer's top; the object's space is meters, y-up.
    const pillCenter = panelHeight + GRAB_GAP + GRAB_HEIGHT / 2;
    object.position.y = (panelLayerHeight / 2 - pillCenter) * METERS_PER_PIXEL;
  }

  function setVisible(value: boolean) {
    visible = value;
    layer.setVisible(value);
  }

  function setHighlighted(value: boolean) {
    if (value === highlighted) return;
    highlighted = value;
    layer.invalidate();
  }

  const plane = new Plane();
  const normal = new Vector3();
  const origin = new Vector3();
  const point = new Vector3();
  const local = new Vector3();

  /**
   * Where the ray meets the bar's hit area, as layout x across the panel, the point in world
   * space, and the distance; or null if it misses, comes from behind, or the bar is hidden.
   */
  function hitTest(raycaster: Raycaster) {
    if (!visible) return null;
    // The panel may have moved since the last render.
    object.updateMatrixWorld();
    normal.set(0, 0, 1).transformDirection(object.matrixWorld);
    // Like the panels' planes, the bar only answers rays that reach its front.
    if (raycaster.ray.direction.dot(normal) >= 0) return null;
    origin.setFromMatrixPosition(object.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(normal, origin);
    if (!raycaster.ray.intersectPlane(plane, point)) return null;
    object.worldToLocal(local.copy(point));
    // Layout pixels across the panel, and down from its bottom edge.
    const x = panelWidth / 2 + local.x / METERS_PER_PIXEL;
    const y = GRAB_GAP + GRAB_HEIGHT / 2 - local.y / METERS_PER_PIXEL;
    if (!isOnGrabBar(x, y, panelWidth, 0)) return null;
    return {
      x,
      point: point.clone(),
      distance: raycaster.ray.origin.distanceTo(point),
    };
  }

  return {
    object,
    setVisible,
    setUsesLayers: layer.setUsesLayers,
    setHighlighted,
    placeBelow,
    hitTest,
    update: layer.update,
    dispose: layer.dispose,
  };
}

export type GrabBar = ReturnType<typeof createGrabBar>;
