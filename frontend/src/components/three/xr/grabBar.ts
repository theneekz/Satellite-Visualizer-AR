import {
  Quaternion,
  Vector3,
  type Raycaster,
  type WebGPURenderer,
} from "three/webgpu";
import { createCanvasLayer } from "./canvasLayer";
import {
  GRAB_SPACE,
  METERS_PER_PIXEL,
  PIXEL_RATIO,
  drawGrabBar,
  isOnGrabBar,
} from "./panelStyle";

/**
 * A panel's grab bar on its own layer, a strip `GRAB_SPACE` tall below the panel. Its own frame
 * keeps the panel's layer from carrying a transparent gap, which would punch a hole through the
 * scene. The bar is a child of the panel's `object`, so it moves with the panel when dragged.
 * Call `placeBelow` each frame with the panel's drawn height so the bar stays under the panel.
 */
export function createGrabBar(renderer: WebGPURenderer, panelWidth: number) {
  let highlighted = false;

  const layer = createCanvasLayer(renderer, {
    width: panelWidth,
    height: GRAB_SPACE,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    // The pose comes from the parent panel, so the layer starts at the origin of its object.
    position: new Vector3(),
    quaternion: new Quaternion(),
    draw: (ctx) => drawGrabBar(ctx, panelWidth, highlighted),
  });

  /**
   * Moves the bar to sit under a panel drawn `panelHeight` tall. The panel's layer is
   * `panelLayerHeight` tall and centered on its object, so its bottom edge is
   * `panelLayerHeight / 2 - panelHeight` above the object's origin.
   */
  function placeBelow(panelHeight: number, panelLayerHeight: number) {
    layer.object.position.y =
      panelLayerHeight / 2 - panelHeight - GRAB_SPACE / 2;
  }

  function setHighlighted(value: boolean) {
    if (value === highlighted) return;
    highlighted = value;
    layer.invalidate();
  }

  /**
   * The ray's hit on the bar, with its layout x, the point in world space, and the distance; or
   * null if it misses the bar's hit area (which reaches past the bar's pill on every side but the
   * panel's).
   */
  function hitTest(raycaster: Raycaster) {
    const hit = layer.hitTest(raycaster);
    if (!hit || !isOnGrabBar(hit.x, hit.y, panelWidth, 0)) return null;
    return {
      x: hit.x,
      point: hit.point,
      distance: hit.distance,
    };
  }

  return {
    object: layer.object,
    setVisible: layer.setVisible,
    setUsesLayers: layer.setUsesLayers,
    setHighlighted,
    placeBelow,
    hitTest,
    update: layer.update,
    dispose: layer.dispose,
  };
}

export type GrabBar = ReturnType<typeof createGrabBar>;
