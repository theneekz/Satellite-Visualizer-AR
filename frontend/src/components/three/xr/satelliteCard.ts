import type {
  Quaternion,
  Raycaster,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { PositionsSnapshot, SatelliteInfo } from "../../../api/satellites";
import type { LiveState } from "../../liveState";
import {
  liveStateAt,
  satelliteDetails,
  type DetailMetric,
  type DetailSection,
} from "../../satelliteDetails";
import { createCanvasLayer } from "./canvasLayer";
import {
  BADGE_COLORS,
  BADGE_HEIGHT,
  CLOSE_SIZE,
  COLORS,
  GRAB_SPACE,
  LINE_HEIGHT,
  METERS_PER_PIXEL,
  PADDING,
  PIXEL_RATIO,
  TEXT_SIZE,
  TITLE_SIZE,
  VALUE_SIZE,
  badgeWidth,
  drawBadge,
  drawCloseButton,
  drawGrabBar,
  drawText,
  isOnCloseButton,
  isOnGrabBar,
} from "./panelStyle";

// Layout, in layout pixels. The page's card is one 300px column; in the room the four sections
// sit in a 2x2 grid instead, so the card stays within a comfortable field of view.
const WIDTH = 520;
// The layer's size is fixed when it is created, so it fits the tallest card (badges on two rows)
// with the grab bar below it. A shorter card leaves the rest transparent.
const MAX_HEIGHT = 448;
const COLUMN_GAP = 24;
const COLUMN_WIDTH = (WIDTH - 2 * PADDING - COLUMN_GAP) / 2;
const METRIC_GAP_X = 12;
const METRIC_GAP_Y = 10;
const METRIC_WIDTH = (COLUMN_WIDTH - METRIC_GAP_X) / 2;
const METRIC_HEIGHT = (TEXT_SIZE + VALUE_SIZE) * LINE_HEIGHT;
const SECTION_GAP = 12;
const CLOSE_X = WIDTH - PADDING - CLOSE_SIZE;
const CLOSE_Y = PADDING;
const LAYER_HEIGHT = MAX_HEIGHT + GRAB_SPACE;

export type CardRegion = "close" | "grab" | "card";

/**
 * The XR version of SatelliteCard: the same details (see satelliteDetails), drawn on a WebXR
 * layer placed in the room. The live position refreshes once a second, like the page's card.
 */
export function createXRSatelliteCard(
  renderer: WebGPURenderer,
  position: Vector3,
  quaternion: Quaternion
) {
  let satellite: SatelliteInfo | null = null;
  let live: LiveState | null = null;
  let nowMs = Date.now();
  let closeHovered = false;
  let grabHighlighted = false;
  // The drawn card's height, which varies with how the badges wrap; set by each draw.
  let height = MAX_HEIGHT;

  const layer = createCanvasLayer(renderer, {
    width: WIDTH,
    height: LAYER_HEIGHT,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    position,
    quaternion,
    draw,
  });

  function drawMetric(
    ctx: CanvasRenderingContext2D,
    metric: DetailMetric,
    x: number,
    y: number,
    width: number
  ) {
    ctx.fillStyle = COLORS.muted;
    const keyHeight = drawText(ctx, metric.label, x, y, TEXT_SIZE, 400, width);
    ctx.fillStyle = COLORS.text;
    drawText(ctx, metric.value, x, y + keyHeight, VALUE_SIZE, 500, width);
  }

  /** A section's height from its top border, matching how drawSection lays it out. */
  function sectionHeight(section: DetailSection) {
    const rows = Math.ceil(section.metrics.length / 2);
    return (
      SECTION_GAP +
      TEXT_SIZE * LINE_HEIGHT +
      6 +
      (section.id === "data" ? METRIC_HEIGHT + 8 : 0) +
      rows * METRIC_HEIGHT +
      (rows - 1) * METRIC_GAP_Y
    );
  }

  /** Draws a section in its column with its top border at `y`. */
  function drawSection(
    ctx: CanvasRenderingContext2D,
    section: DetailSection,
    details: ReturnType<typeof satelliteDetails>,
    x: number,
    y: number
  ) {
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 0.5);
    ctx.lineTo(x + COLUMN_WIDTH, y + 0.5);
    ctx.stroke();

    let top = y + SECTION_GAP;
    ctx.fillStyle = COLORS.muted;
    const labelHeight = drawText(ctx, section.label, x, top, TEXT_SIZE);
    if (section.id === "data") {
      // The element set's age sits on the label's line, where the narrower column has room.
      const width = badgeWidth(ctx, details.age.text);
      drawBadge(
        ctx,
        details.age.text,
        x + COLUMN_WIDTH - width,
        top + (labelHeight - BADGE_HEIGHT) / 2,
        BADGE_COLORS[details.age.level]
      );
    }
    top += labelHeight + 6;

    if (section.id === "data") {
      drawMetric(ctx, details.epoch, x, top, COLUMN_WIDTH);
      top += METRIC_HEIGHT + 8;
    }
    section.metrics.forEach((metric, i) => {
      const column = i % 2;
      const row = Math.floor(i / 2);
      drawMetric(
        ctx,
        metric,
        x + column * (METRIC_WIDTH + METRIC_GAP_X),
        top + row * (METRIC_HEIGHT + METRIC_GAP_Y),
        METRIC_WIDTH
      );
    });
  }

  function draw(ctx: CanvasRenderingContext2D) {
    if (!satellite) return;
    const details = satelliteDetails(satellite, live, nowMs);

    // Lay out the badges first: how they wrap sets the card's height, and the background is
    // drawn before everything else.
    const badgeRows: { text: string; tone: "type" | "plain"; x: number }[][] = [
      [],
    ];
    let rowWidth = 0;
    for (const badge of details.badges) {
      const width = badgeWidth(ctx, badge.text);
      if (rowWidth > 0 && rowWidth + width > WIDTH - 2 * PADDING) {
        badgeRows.push([]);
        rowWidth = 0;
      }
      badgeRows[badgeRows.length - 1].push({ ...badge, x: PADDING + rowWidth });
      rowWidth += width + 6;
    }
    const headerHeight = TITLE_SIZE * LINE_HEIGHT + 2 + TEXT_SIZE * LINE_HEIGHT;
    const badgesTop = PADDING + headerHeight + 10;
    const badgesHeight = details.badges.length
      ? badgeRows.length * BADGE_HEIGHT + (badgeRows.length - 1) * 6
      : 0;
    const sectionsTop = badgesTop + badgesHeight + SECTION_GAP;

    // The sections sit in a 2x2 grid, each row as tall as its taller section.
    const [a, b, c, d] = details.sections;
    const firstRowHeight = Math.max(sectionHeight(a), sectionHeight(b));
    const secondRowHeight = Math.max(sectionHeight(c), sectionHeight(d));
    height = Math.min(
      MAX_HEIGHT,
      sectionsTop + firstRowHeight + SECTION_GAP + secondRowHeight + PADDING
    );

    ctx.fillStyle = COLORS.background;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, WIDTH - 1, height - 1, 12);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Header: name and ids, and the close button.
    ctx.fillStyle = COLORS.text;
    const nameHeight = drawText(
      ctx,
      details.name,
      PADDING,
      PADDING,
      TITLE_SIZE,
      600,
      CLOSE_X - 8 - PADDING
    );
    ctx.fillStyle = COLORS.muted;
    drawText(
      ctx,
      details.subtitle,
      PADDING,
      PADDING + nameHeight + 2,
      TEXT_SIZE,
      400,
      CLOSE_X - 8 - PADDING
    );

    drawCloseButton(ctx, CLOSE_X, CLOSE_Y, closeHovered);

    badgeRows.forEach((row, i) => {
      for (const badge of row) {
        drawBadge(
          ctx,
          badge.text,
          badge.x,
          badgesTop + i * (BADGE_HEIGHT + 6),
          BADGE_COLORS[badge.tone]
        );
      }
    });

    const secondRowTop = sectionsTop + firstRowHeight + SECTION_GAP;
    const rightX = PADDING + COLUMN_WIDTH + COLUMN_GAP;
    drawSection(ctx, a, details, PADDING, sectionsTop);
    drawSection(ctx, b, details, rightX, sectionsTop);
    drawSection(ctx, c, details, PADDING, secondRowTop);
    drawSection(ctx, d, details, rightX, secondRowTop);

    drawGrabBar(ctx, WIDTH, height, grabHighlighted);
  }

  /** Shows the card for this satellite, or hides it for null. */
  function show(next: SatelliteInfo | null) {
    if (next === satellite) return;
    satellite = next;
    closeHovered = false;
    grabHighlighted = false;
    layer.setVisible(next !== null);
    layer.invalidate();
  }

  /** Recomputes the live position from the latest snapshot, as the page's card does each second. */
  function refresh(snapshot: PositionsSnapshot | null, now: number) {
    if (!satellite) return;
    nowMs = now;
    live = liveStateAt(snapshot, satellite.id, now);
    layer.invalidate();
  }

  /**
   * What the ray points at on the card, with the point it meets in `object`'s space and the
   * distance to it; null if it misses the card and its grab bar, including the transparent space
   * below a short card.
   */
  function hitTest(
    raycaster: Raycaster
  ): { region: CardRegion; local: Vector3; distance: number } | null {
    const hit = layer.hitTest(raycaster);
    if (!hit) return null;
    const { x, y, local, distance } = hit;
    if (y > height) {
      return isOnGrabBar(x, y, WIDTH, height)
        ? { region: "grab", local, distance }
        : null;
    }
    const onClose = isOnCloseButton(x, y, CLOSE_X, CLOSE_Y);
    return { region: onClose ? "close" : "card", local, distance };
  }

  function setCloseHovered(hovered: boolean) {
    if (hovered === closeHovered) return;
    closeHovered = hovered;
    layer.invalidate();
  }

  function setGrabHighlighted(highlighted: boolean) {
    if (highlighted === grabHighlighted) return;
    grabHighlighted = highlighted;
    layer.invalidate();
  }

  return {
    object: layer.object,
    setUsesLayers: layer.setUsesLayers,
    show,
    refresh,
    hitTest,
    setCloseHovered,
    setGrabHighlighted,
    update: layer.update,
    dispose: layer.dispose,
  };
}

export type XRSatelliteCard = ReturnType<typeof createXRSatelliteCard>;
