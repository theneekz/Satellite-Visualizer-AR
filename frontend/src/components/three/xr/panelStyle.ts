/**
 * Shared look for the Canvas 2D XR panels, matching the page's panels (SatelliteCard.css and
 * friends). Sizes are layout pixels at the page's 18px root font, so 0.8rem is 14.4.
 */

export const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, sans-serif";
export const LINE_HEIGHT = 1.4;

export const TEXT_SIZE = 14.4;
export const TITLE_SIZE = 18;
export const VALUE_SIZE = 16.2;

export const FONT_WEIGHT_REGULAR = 400;
export const FONT_WEIGHT_MEDIUM = 500;
export const FONT_WEIGHT_SEMIBOLD = 600;

// Corner radii: badges, controls (buttons and inputs), and the panels themselves.
const BADGE_RADIUS = 6;
export const CONTROL_RADIUS = 8;
export const PANEL_RADIUS = 12;

// Canvas draws a 1-pixel stroke centered on its path. Offsetting the path by half a pixel puts
// the stroke on whole pixels, so it stays sharp instead of blurring across two.
export const HALF_PIXEL = 0.5;

// The space between a panel's title and its close button.
export const TITLE_GAP = 8;
// The space between badges, across and down.
export const BADGE_GAP = 6;

export const COLORS = {
  // Opaque, unlike the page's translucent panels: a layer composites behind the scene, so
  // translucency would show the room or black rather than the globe.
  background: "#0d1020",
  border: "rgba(255, 255, 255, 0.12)",
  text: "#fff",
  muted: "rgba(255, 255, 255, 0.55)",
  buttonBorder: "rgba(255, 255, 255, 0.25)",
  buttonText: "rgba(255, 255, 255, 0.8)",
  hover: "rgba(255, 255, 255, 0.08)",
  grab: "rgba(255, 255, 255, 0.35)",
  grabActive: "rgba(255, 255, 255, 0.85)",
  rowBorder: "rgba(255, 255, 255, 0.08)",
  rowHover: "rgba(255, 255, 255, 0.06)",
  selected: "rgba(133, 183, 235, 0.16)",
  selectedBorder: "rgba(133, 183, 235, 0.4)",
  scrollbar: "rgba(255, 255, 255, 0.25)",
  // Inputs and chips, like .satellite-filters__control.
  field: "rgba(255, 255, 255, 0.08)",
  fieldBorder: "rgba(255, 255, 255, 0.2)",
  focus: "#85b7eb",
  track: "rgba(255, 255, 255, 0.2)",
};

// The close button in a panel's top right corner.
export const CLOSE_SIZE = 32;

// The grab bar for moving a panel, a pill centered under it in the style of Horizon OS and
// visionOS windows. Its hit area reaches GRAB_SLOP past it on every side but the panel's.
export const GRAB_GAP = 12;
export const GRAB_WIDTH = 120;
export const GRAB_HEIGHT = 8;
export const GRAB_SLOP = 14;
// The space below a panel that the grab bar's hit area covers: the gap, the bar, and the slop.
export const GRAB_SPACE = GRAB_GAP + GRAB_HEIGHT + GRAB_SLOP;

// Space between a panel's edge and its contents.
export const PADDING = 20;

// About 1.5 canvas pixels per display pixel at a panel's distance, and 1mm per layout pixel, so
// the 14.4px body text is about 0.8 degrees tall from a meter away.
export const PIXEL_RATIO = 1.5;
export const METERS_PER_PIXEL = 0.001;

export const BADGE_COLORS = {
  plain: {
    text: "rgba(255, 255, 255, 0.75)",
    background: "rgba(255, 255, 255, 0.1)",
  },
  type: { text: "#9fe1cb", background: "rgba(29, 158, 117, 0.22)" },
  fresh: { text: "#c0dd97", background: "rgba(99, 153, 34, 0.25)" },
  aging: { text: "#fac775", background: "rgba(186, 117, 23, 0.25)" },
  stale: { text: "#f7c1c1", background: "rgba(226, 75, 74, 0.25)" },
};

const BADGE_PADDING_X = 8;
const BADGE_PADDING_Y = 2;
export const BADGE_HEIGHT = TEXT_SIZE * LINE_HEIGHT + 2 * BADGE_PADDING_Y;

const CLOSE_ICON_SIZE = 20;
// The grab bar widens by this much on each side under a ray or while dragged. Its layer is wide
// enough for the widest bar, so the layer never changes size.
export const GRAB_HIGHLIGHT_GROW = 12;
export const GRAB_HIGHLIGHT_WIDTH = GRAB_WIDTH + 2 * GRAB_HIGHLIGHT_GROW;

export function font(size: number, weight = FONT_WEIGHT_REGULAR) {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/**
 * Draws one line of text in a line box of LINE_HEIGHT whose top is at `y`, like a CSS line, cut
 * short with an ellipsis if wider than `maxWidth`. Returns the line box's height.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight = FONT_WEIGHT_REGULAR,
  maxWidth = Infinity
) {
  ctx.font = font(size, weight);
  ctx.textBaseline = "top";
  if (ctx.measureText(text).width > maxWidth) {
    // Binary search for the longest prefix that fits with the ellipsis, since the list truncates
    // many names on every scrolled frame.
    let low = 0;
    let high = text.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth)
        low = mid;
      else high = mid - 1;
    }
    text = `${text.slice(0, low).trimEnd()}…`;
  }
  ctx.fillText(text, x, y + (size * (LINE_HEIGHT - 1)) / 2);
  return size * LINE_HEIGHT;
}

export function badgeWidth(ctx: CanvasRenderingContext2D, text: string) {
  ctx.font = font(TEXT_SIZE);
  return ctx.measureText(text).width + 2 * BADGE_PADDING_X;
}

/** Draws a badge with its top left at (x, y), like .satellite-card__badge. */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colors: { text: string; background: string }
) {
  const width = badgeWidth(ctx, text);
  ctx.fillStyle = colors.background;
  ctx.beginPath();
  ctx.roundRect(x, y, width, BADGE_HEIGHT, BADGE_RADIUS);
  ctx.fill();
  ctx.fillStyle = colors.text;
  drawText(ctx, text, x + BADGE_PADDING_X, y + BADGE_PADDING_Y, TEXT_SIZE);
  return width;
}

/** Draws the close button with its top left at (x, y), like the page's close buttons. */
export function drawCloseButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hovered: boolean
) {
  ctx.beginPath();
  ctx.roundRect(
    x + HALF_PIXEL,
    y + HALF_PIXEL,
    CLOSE_SIZE - 1,
    CLOSE_SIZE - 1,
    CONTROL_RADIUS
  );
  if (hovered) {
    ctx.fillStyle = COLORS.hover;
    ctx.fill();
  }
  ctx.strokeStyle = COLORS.buttonBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = COLORS.buttonText;
  ctx.font = font(CLOSE_ICON_SIZE);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The × sits slightly high in the font's em box, so nudge it down a pixel to look centered.
  ctx.fillText("×", x + CLOSE_SIZE / 2, y + CLOSE_SIZE / 2 + 1);
  ctx.textAlign = "left";
}

export function isOnCloseButton(
  x: number,
  y: number,
  buttonX: number,
  buttonY: number
) {
  return (
    x >= buttonX &&
    x <= buttonX + CLOSE_SIZE &&
    y >= buttonY &&
    y <= buttonY + CLOSE_SIZE
  );
}

/**
 * Draws the grab bar pill into its own layer, which is `GRAB_HIGHLIGHT_WIDTH` wide. The pill
 * widens a little under a ray or while dragged, growing out from the middle.
 */
export function drawGrabPill(ctx: CanvasRenderingContext2D, highlighted: boolean) {
  const grow = highlighted ? GRAB_HIGHLIGHT_GROW : 0;
  ctx.fillStyle = highlighted ? COLORS.grabActive : COLORS.grab;
  ctx.beginPath();
  ctx.roundRect(
    GRAB_HIGHLIGHT_GROW - grow,
    0,
    GRAB_WIDTH + 2 * grow,
    GRAB_HEIGHT,
    GRAB_HEIGHT / 2
  );
  ctx.fill();
}

/** Whether (x, y), below the panel, is on the grab bar's hit area. */
export function isOnGrabBar(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number
) {
  const left = (panelWidth - GRAB_WIDTH) / 2;
  return (
    x >= left - GRAB_SLOP &&
    x <= left + GRAB_WIDTH + GRAB_SLOP &&
    y > panelHeight &&
    y <= panelHeight + GRAB_SPACE
  );
}
