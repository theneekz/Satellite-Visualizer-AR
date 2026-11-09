import { Quaternion, Vector3, type WebGPURenderer } from "three/webgpu";
import { createCanvasLayer } from "./canvasLayer";
import {
  COLORS,
  CONTROL_RADIUS,
  GRAB_GAP,
  HALF_PIXEL,
  LINE_HEIGHT,
  METERS_PER_PIXEL,
  PIXEL_RATIO,
  TEXT_SIZE,
  drawText,
  wrapText,
} from "./panelStyle";

// The longest explanation fits on three lines at the panel's width.
const MAX_LINES = 3;
const PADDING_X = 16;
const PADDING_Y = 12;
const HEIGHT = Math.ceil(MAX_LINES * TEXT_SIZE * LINE_HEIGHT + 2 * PADDING_Y);

/**
 * The XR card's tooltip: one strip docked above the panel, showing the explanation of whatever
 * the ray points at. A layer's size is fixed and its transparent areas punch holes through the
 * scene, so a bubble sized to its text and placed beside each item isn't possible. The strip is
 * always the same opaque size instead, and it never covers the panel's data. It is a child of
 * the panel's `object`, so it moves with the panel when dragged.
 */
export function createHelpStrip(
  renderer: WebGPURenderer,
  panelWidth: number,
  panelHeight: number
) {
  let text: string | null = null;

  const layer = createCanvasLayer(renderer, {
    width: panelWidth,
    height: HEIGHT,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    // The pose comes from the parent panel; only the offset below is the strip's own.
    position: new Vector3(),
    quaternion: new Quaternion(),
    draw,
  });
  layer.object.position.y =
    (panelHeight / 2 + GRAB_GAP + HEIGHT / 2) * METERS_PER_PIXEL;

  function draw(ctx: CanvasRenderingContext2D) {
    if (text === null) return;
    ctx.fillStyle = COLORS.background;
    ctx.beginPath();
    ctx.roundRect(
      HALF_PIXEL,
      HALF_PIXEL,
      panelWidth - 1,
      HEIGHT - 1,
      CONTROL_RADIUS
    );
    ctx.fill();
    ctx.strokeStyle = COLORS.buttonBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const maxWidth = panelWidth - 2 * PADDING_X;
    const lines = wrapText(ctx, text, TEXT_SIZE, maxWidth, MAX_LINES);
    const lineHeight = TEXT_SIZE * LINE_HEIGHT;
    let y = (HEIGHT - lines.length * lineHeight) / 2;
    ctx.fillStyle = COLORS.text;
    for (const line of lines) {
      y += drawText(ctx, line, PADDING_X, y, TEXT_SIZE, undefined, maxWidth);
    }
  }

  /** Shows this explanation, or hides the strip for null. */
  function setText(next: string | null) {
    if (next === text) return;
    text = next;
    layer.setVisible(next !== null);
    layer.invalidate();
  }

  return {
    object: layer.object,
    setText,
    setUsesLayers: layer.setUsesLayers,
    update: layer.update,
    dispose: layer.dispose,
  };
}

export type HelpStrip = ReturnType<typeof createHelpStrip>;
