/**
 * Shared look for the Canvas 2D XR panels, matching the page's panels (SatelliteCard.css and
 * friends). Sizes are layout pixels at the page's 18px root font, so 0.8rem is 14.4.
 */

export const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, sans-serif";
export const LINE_HEIGHT = 1.4;

export const TEXT_SIZE = 14.4;
export const TITLE_SIZE = 18;
export const VALUE_SIZE = 16.2;

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
};

export const BADGE_COLORS = {
  plain: { text: "rgba(255, 255, 255, 0.75)", background: "rgba(255, 255, 255, 0.1)" },
  type: { text: "#9fe1cb", background: "rgba(29, 158, 117, 0.22)" },
  fresh: { text: "#c0dd97", background: "rgba(99, 153, 34, 0.25)" },
  aging: { text: "#fac775", background: "rgba(186, 117, 23, 0.25)" },
  stale: { text: "#f7c1c1", background: "rgba(226, 75, 74, 0.25)" },
};

export const BADGE_HEIGHT = TEXT_SIZE * LINE_HEIGHT + 4;
const BADGE_PADDING_X = 8;

export function font(size: number, weight = 400) {
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
  weight = 400,
  maxWidth = Infinity
) {
  ctx.font = font(size, weight);
  ctx.textBaseline = "top";
  if (ctx.measureText(text).width > maxWidth) {
    let end = text.length;
    while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
    text = `${text.slice(0, end).trimEnd()}…`;
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
  ctx.roundRect(x, y, width, BADGE_HEIGHT, 6);
  ctx.fill();
  ctx.fillStyle = colors.text;
  drawText(ctx, text, x + BADGE_PADDING_X, y + 2, TEXT_SIZE);
  return width;
}
