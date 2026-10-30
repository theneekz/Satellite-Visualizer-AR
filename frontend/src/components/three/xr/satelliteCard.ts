import {
  Group,
  Quaternion,
  Vector3,
  type Raycaster,
  type WebGPURenderer,
} from "three/webgpu";
import type { PositionsSnapshot, SatelliteInfo } from "../../../api/satellites";
import type { LiveState } from "../../liveState";
import {
  liveStateAt,
  satelliteDetails,
  type DetailMetric,
  type DetailSection,
} from "../../satelliteDetails";
import { createCanvasLayer, type CanvasLayer } from "./canvasLayer";
import { createGrabBar } from "./grabBar";
import {
  BADGE_COLORS,
  BADGE_HEIGHT,
  CLOSE_SIZE,
  COLORS,
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
  isOnGrabBar,
} from "./panelStyle";

// Layout, in layout pixels. The page's card is one 300px column; in the room the four sections
// sit in a 2x2 grid instead, so the card stays within a comfortable field of view.
const WIDTH = 520;
// The tallest card (badges on two rows). Cards shorter than this are still their own height.
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

// Measures text before a card is drawn, since its height decides which layer it draws on.
const measureCtx = document.createElement("canvas").getContext("2d")!;

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
  let usesLayers = false;
  // The current card's height, whole pixels, which sets its layer's height.
  let height = MAX_HEIGHT;

  // Every layer and the grab bar hang off one group, which carries the card's pose. Dragging
  // moves the group, and three.js moves each layer with its parent every frame.
  const root = new Group();
  root.position.copy(position);
  root.quaternion.copy(quaternion);

  // One layer per card height, sized to that card alone so no empty area shows through below it.
  // Created when a card first needs that height. Layers are never removed, since three.js cannot
  // remove one; a hidden layer draws nothing.
  const layers = new Map<number, CanvasLayer>();
  // The layer showing the current card, or null while no card is shown.
  let layer: CanvasLayer | null = null;

  const grabBar = createGrabBar(renderer);
  root.add(grabBar.object);
  grabBar.setVisible(false);

  function layerFor(cardHeight: number) {
    let found = layers.get(cardHeight);
    if (!found) {
      found = createCanvasLayer(renderer, {
        width: WIDTH,
        height: cardHeight,
        pixelRatio: PIXEL_RATIO,
        metersPerPixel: METERS_PER_PIXEL,
        // Positioned by the group, so the layer sits at its origin.
        position: new Vector3(),
        quaternion: new Quaternion(),
        draw,
      });
      found.setUsesLayers(usesLayers);
      root.add(found.object);
      layers.set(cardHeight, found);
    }
    return found;
  }

  /** Shows the layer that fits the current card, then redraws it and places the grab bar. */
  function syncLayer() {
    if (!satellite) {
      layer?.setVisible(false);
      layer = null;
      grabBar.setVisible(false);
      return;
    }
    const details = satelliteDetails(satellite, live, nowMs);
    height = cardLayout(measureCtx, details).height;
    const next = layerFor(height);
    if (next !== layer) {
      layer?.setVisible(false);
      layer = next;
      layer.setVisible(true);
    }
    layer.invalidate();
    grabBar.place(height, height);
    grabBar.setVisible(true);
  }

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

  /**
   * Lays out the card: where the badge rows and sections sit, and the card's height in whole
   * pixels. The height depends on how the badges wrap and how tall each section is.
   */
  function cardLayout(
    ctx: CanvasRenderingContext2D,
    details: ReturnType<typeof satelliteDetails>
  ) {
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
    const firstRowHeight = Math.max(
      sectionHeight(details.sections[0]),
      sectionHeight(details.sections[1])
    );
    const secondRowHeight = Math.max(
      sectionHeight(details.sections[2]),
      sectionHeight(details.sections[3])
    );
    const height = Math.ceil(
      Math.min(
        MAX_HEIGHT,
        sectionsTop + firstRowHeight + SECTION_GAP + secondRowHeight + PADDING
      )
    );
    return { badgeRows, badgesTop, sectionsTop, firstRowHeight, height };
  }

  function draw(ctx: CanvasRenderingContext2D) {
    if (!satellite) return;
    const details = satelliteDetails(satellite, live, nowMs);
    const layout = cardLayout(ctx, details);
    const { badgeRows, badgesTop, sectionsTop, firstRowHeight } = layout;
    const height = layout.height;
    const [a, b, c, d] = details.sections;

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

  }

  /** Shows the card for this satellite, or hides it for null. */
  function show(next: SatelliteInfo | null) {
    if (next === satellite) return;
    satellite = next;
    closeHovered = false;
    grabBar.setHighlighted(false);
    syncLayer();
  }

  /** Recomputes the live position from the latest snapshot, as the page's card does each second. */
  function refresh(snapshot: PositionsSnapshot | null, now: number) {
    if (!satellite) return;
    nowMs = now;
    live = liveStateAt(snapshot, satellite.id, now);
    syncLayer();
  }

  /**
   * What the ray points at on the card, with the point it meets in `object`'s space and the
   * distance to it; null if it misses the card and its grab bar.
   */
  function hitTest(
    raycaster: Raycaster
  ): { region: CardRegion; local: Vector3; distance: number } | null {
    const hit = layer?.hitPlane(raycaster);
    if (!hit) return null;
    const { x, y, local, distance } = hit;
    if (y > height) {
      return isOnGrabBar(x, y, WIDTH, height)
        ? { region: "grab", local, distance }
        : null;
    }
    if (x < 0 || x > WIDTH || y < 0) return null;
    const onClose = isOnCloseButton(x, y, CLOSE_X, CLOSE_Y);
    return { region: onClose ? "close" : "card", local, distance };
  }

  function setCloseHovered(hovered: boolean) {
    if (hovered === closeHovered) return;
    closeHovered = hovered;
    layer?.invalidate();
  }

  function setGrabHighlighted(highlighted: boolean) {
    grabBar.setHighlighted(highlighted);
  }

  /** Whether the current session shows the card as layers (see canvasLayer). */
  function setUsesLayers(value: boolean) {
    usesLayers = value;
    for (const each of layers.values()) each.setUsesLayers(value);
    grabBar.setUsesLayers(value);
  }

  function update() {
    for (const each of layers.values()) each.update();
    grabBar.update();
  }

  function dispose() {
    for (const each of layers.values()) each.dispose();
    grabBar.dispose();
  }

  return {
    object: root,
    setUsesLayers,
    show,
    refresh,
    hitTest,
    setCloseHovered,
    setGrabHighlighted,
    update,
    dispose,
  };
}

export type XRSatelliteCard = ReturnType<typeof createXRSatelliteCard>;
