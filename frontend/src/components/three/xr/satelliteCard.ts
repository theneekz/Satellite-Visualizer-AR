import type {
  Quaternion,
  Raycaster,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { PositionsSnapshot, SatelliteInfo } from "../../../api/satellites";
import type { LiveState } from "../../liveState";
import {
  CARD_HELP,
  liveStateAt,
  satelliteDetails,
  type DetailBadge,
  type DetailMetric,
  type DetailSection,
} from "../../satelliteDetails";
import { createCanvasLayer } from "./canvasLayer";
import { createGrabBar } from "./grabBar";
import { createHelpStrip } from "./helpStrip";
import {
  BADGE_COLORS,
  BADGE_HEIGHT,
  CLOSE_SIZE,
  COLORS,
  CONTROL_RADIUS,
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
  drawText,
  isOnCloseButton,
} from "./panelStyle";

// Layout, in layout pixels. The page's card is one 300px column; in the room the four sections
// sit in a 2x2 grid instead, so the card stays within a comfortable field of view.
const WIDTH = 520;
// The layer's size is fixed when it is created, so every card is drawn this tall: enough for the
// tallest card (badges on two rows). A shorter card leaves empty space at its bottom rather than
// a transparent area, which would punch a hole through the scene. The grab bar has its own layer
// below this one.
const HEIGHT = 448;
const COLUMN_GAP = 24;
const COLUMN_WIDTH = (WIDTH - 2 * PADDING - COLUMN_GAP) / 2;
const METRIC_GAP_X = 12;
const METRIC_GAP_Y = 10;
const METRIC_WIDTH = (COLUMN_WIDTH - METRIC_GAP_X) / 2;
const METRIC_HEIGHT = (TEXT_SIZE + VALUE_SIZE) * LINE_HEIGHT;
const SECTION_GAP = 12;
const CLOSE_X = WIDTH - PADDING - CLOSE_SIZE;
const CLOSE_Y = PADDING;

// A controller ray is less steady than a mouse, so the help strip only changes once the ray has
// stayed on (or off) an item this long. Without the wait, sweeping across the card flashes it.
const HELP_DELAY_MS = 200;
// How far the highlight on the explained item reaches past the item.
const HELP_HIGHLIGHT_MARGIN = 3;

export type CardRegion = "close" | "grab" | "card";

/** A part of the card, in layout pixels, and its explanation. */
interface HelpRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  help: string;
}

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

  // Rebuilt on every draw, since the badges' wrapping moves everything below them.
  let helpRegions: HelpRegion[] = [];
  // The explanation on show, and the one the ray has moved to while it waits out HELP_DELAY_MS.
  let shownHelp: string | null = null;
  let pendingHelp: string | null = null;
  let pendingSinceMs = 0;

  const layer = createCanvasLayer(renderer, {
    width: WIDTH,
    height: HEIGHT,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    position,
    quaternion,
    draw,
  });
  // Under the card, moving with it since it is a child of the card's object.
  const grabBar = createGrabBar(renderer, WIDTH);
  layer.object.add(grabBar.object);
  grabBar.placeBelow(HEIGHT, HEIGHT);
  const helpStrip = createHelpStrip(renderer, WIDTH, HEIGHT);
  layer.object.add(helpStrip.object);

  function drawMetric(
    ctx: CanvasRenderingContext2D,
    metric: DetailMetric,
    x: number,
    y: number,
    width: number
  ) {
    helpRegions.push({ x, y, width, height: METRIC_HEIGHT, help: metric.help });
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
    helpRegions.push({
      x,
      y: top,
      width: ctx.measureText(section.label).width,
      height: labelHeight,
      help: section.help,
    });
    if (section.id === "data") {
      // The element set's age sits on the label's line, where the narrower column has room.
      const width = badgeWidth(ctx, details.age.text);
      const badgeX = x + COLUMN_WIDTH - width;
      const badgeY = top + (labelHeight - BADGE_HEIGHT) / 2;
      drawBadge(
        ctx,
        details.age.text,
        badgeX,
        badgeY,
        BADGE_COLORS[details.age.level]
      );
      helpRegions.push({
        x: badgeX,
        y: badgeY,
        width,
        height: BADGE_HEIGHT,
        help: CARD_HELP.age,
      });
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

    // Lay out the badges first: how they wrap sets where the sections start. The card's height
    // is always HEIGHT, so a card whose badges fit on one row has empty space at its bottom.
    const badgeRows: (DetailBadge & { x: number })[][] = [[]];
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

    ctx.fillStyle = COLORS.background;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1, 12);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Marks the item the help strip explains, which is otherwise far from the strip. Regions come
    // from the previous draw, which is the one the ray was pointing at.
    const explained = helpRegions.find((region) => region.help === shownHelp);
    if (explained) {
      ctx.fillStyle = COLORS.hover;
      ctx.beginPath();
      ctx.roundRect(
        explained.x - HELP_HIGHLIGHT_MARGIN,
        explained.y - HELP_HIGHLIGHT_MARGIN,
        explained.width + 2 * HELP_HIGHLIGHT_MARGIN,
        explained.height + 2 * HELP_HIGHLIGHT_MARGIN,
        CONTROL_RADIUS
      );
      ctx.fill();
    }
    helpRegions = [];

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
    helpRegions.push({
      x: PADDING,
      y: PADDING,
      width: Math.min(
        ctx.measureText(details.name).width,
        CLOSE_X - 8 - PADDING
      ),
      height: nameHeight,
      help: CARD_HELP.name,
    });
    ctx.fillStyle = COLORS.muted;
    const subtitleY = PADDING + nameHeight + 2;
    const subtitleHeight = drawText(
      ctx,
      details.subtitle,
      PADDING,
      subtitleY,
      TEXT_SIZE,
      400,
      CLOSE_X - 8 - PADDING
    );
    // The subtitle is one line of text, so each identifier's region comes from measuring it.
    let identifierX = PADDING;
    const separatorWidth = ctx.measureText(" · ").width;
    for (const identifier of details.identifiers) {
      const width = ctx.measureText(identifier.text).width;
      helpRegions.push({
        x: identifierX,
        y: subtitleY,
        width: Math.min(width, CLOSE_X - 8 - identifierX),
        height: subtitleHeight,
        help: identifier.help,
      });
      identifierX += width + separatorWidth;
    }

    drawCloseButton(ctx, CLOSE_X, CLOSE_Y, closeHovered);

    badgeRows.forEach((row, i) => {
      const y = badgesTop + i * (BADGE_HEIGHT + 6);
      for (const badge of row) {
        const width = drawBadge(
          ctx,
          badge.text,
          badge.x,
          y,
          BADGE_COLORS[badge.tone]
        );
        helpRegions.push({
          x: badge.x,
          y,
          width,
          height: BADGE_HEIGHT,
          help: badge.help,
        });
      }
    });

    const secondRowTop = sectionsTop + firstRowHeight + SECTION_GAP;
    const rightX = PADDING + COLUMN_WIDTH + COLUMN_GAP;
    drawSection(ctx, a, details, PADDING, sectionsTop);
    drawSection(ctx, b, details, rightX, sectionsTop);
    drawSection(ctx, c, details, PADDING, secondRowTop);
    drawSection(ctx, d, details, rightX, secondRowTop);
  }

  /** Shows the card for this satellite, or hides it for null. */
  function show(next: SatelliteInfo | null) {
    if (next === satellite) return;
    satellite = next;
    closeHovered = false;
    grabHighlighted = false;
    grabBar.setHighlighted(false);
    layer.setVisible(next !== null);
    grabBar.setVisible(next !== null);
    helpRegions = [];
    shownHelp = null;
    pendingHelp = null;
    helpStrip.setText(null);
    layer.invalidate();
  }

  function update() {
    layer.update();
    grabBar.update();
    helpStrip.update();
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
   * distance to it; null if it misses the card and its grab bar.
   */
  function hitTest(raycaster: Raycaster): {
    region: CardRegion;
    local: Vector3;
    distance: number;
    help: string | null;
  } | null {
    // Tested first, so the card's own layer updates the matrices the bar's test relies on.
    const hit = layer.hitTest(raycaster);
    const bar = grabBar.hitTest(raycaster);
    if (bar) {
      return {
        region: "grab",
        local: layer.object.worldToLocal(bar.point.clone()),
        distance: bar.distance,
        help: null,
      };
    }
    if (!hit) return null;
    const { x, y, local, distance } = hit;
    const onClose = isOnCloseButton(x, y, CLOSE_X, CLOSE_Y);
    if (onClose) return { region: "close", local, distance, help: null };
    const pointed = helpRegions.find(
      (region) =>
        x >= region.x &&
        x <= region.x + region.width &&
        y >= region.y &&
        y <= region.y + region.height
    );
    return { region: "card", local, distance, help: pointed?.help ?? null };
  }

  function setCloseHovered(hovered: boolean) {
    if (hovered === closeHovered) return;
    closeHovered = hovered;
    layer.invalidate();
  }

  /** Call every frame with the explanation the ray points at, or null if it points at none. */
  function setPointedHelp(help: string | null) {
    const now = performance.now();
    if (help !== pendingHelp) {
      pendingHelp = help;
      pendingSinceMs = now;
    }
    if (pendingHelp === shownHelp || now - pendingSinceMs < HELP_DELAY_MS)
      return;
    shownHelp = pendingHelp;
    helpStrip.setText(shownHelp);
    layer.invalidate();
  }

  function setGrabHighlighted(highlighted: boolean) {
    if (highlighted === grabHighlighted) return;
    grabHighlighted = highlighted;
    grabBar.setHighlighted(highlighted);
  }

  return {
    object: layer.object,
    setUsesLayers: (value: boolean) => {
      layer.setUsesLayers(value);
      grabBar.setUsesLayers(value);
      helpStrip.setUsesLayers(value);
    },
    show,
    refresh,
    hitTest,
    setCloseHovered,
    setPointedHelp,
    setGrabHighlighted,
    update,
    dispose: () => {
      layer.dispose();
      grabBar.dispose();
      helpStrip.dispose();
    },
  };
}

export type XRSatelliteCard = ReturnType<typeof createXRSatelliteCard>;
