import { Quaternion, Vector3, type WebGPURenderer } from "three/webgpu";
import { createCanvasLayer } from "./canvasLayer";
import {
  GRAB_GAP,
  GRAB_HEIGHT,
  GRAB_HIGHLIGHT_WIDTH,
  METERS_PER_PIXEL,
  PIXEL_RATIO,
  drawGrabPill,
} from "./panelStyle";

/**
 * The grab bar under a panel, in its own layer so the layer holds only the pill. A panel's
 * layer then has no empty area below it, and the room never shows through a frame around the
 * bar. The bar's hit area is tested against the panel's plane instead (see `isOnGrabBar`).
 *
 * The bar's object sits under the panel's origin, so it must be a child of the panel's group.
 */
export function createGrabBar(renderer: WebGPURenderer) {
  let highlighted = false;

  const layer = createCanvasLayer(renderer, {
    width: GRAB_HIGHLIGHT_WIDTH,
    height: GRAB_HEIGHT,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    position: new Vector3(),
    quaternion: new Quaternion(),
    draw: (ctx) => drawGrabPill(ctx, highlighted),
  });

  /**
   * Puts the bar under a panel whose layout is `layerHeight` tall, with its top edge at
   * `panelHeight` (the drawn panel's height, which can be shorter than its layer).
   */
  function place(layerHeight: number, panelHeight: number) {
    const barCenter = panelHeight + GRAB_GAP + GRAB_HEIGHT / 2;
    layer.object.position.set(
      0,
      (layerHeight / 2 - barCenter) * METERS_PER_PIXEL,
      0
    );
  }

  function setHighlighted(value: boolean) {
    if (value === highlighted) return;
    highlighted = value;
    layer.invalidate();
  }

  return {
    object: layer.object,
    setUsesLayers: layer.setUsesLayers,
    setVisible: layer.setVisible,
    place,
    setHighlighted,
    update: layer.update,
    dispose: layer.dispose,
  };
}

export type GrabBar = ReturnType<typeof createGrabBar>;
