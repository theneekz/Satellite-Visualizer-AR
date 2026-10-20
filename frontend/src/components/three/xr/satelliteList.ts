import type {
  Quaternion,
  Raycaster,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { SatelliteInfo } from "../../../api/satellites";
import {
  isFiltering,
  type FilterOptions,
  type SatelliteFilters,
} from "../../../filters";
import {
  CURRENT_YEAR,
  FIRST_LAUNCH_YEAR,
  SEARCH_DEBOUNCE_MS,
} from "../../../constants";
import { sentenceCase } from "../../../format";
import { createCanvasLayer } from "./canvasLayer";
import {
  CLOSE_SIZE,
  COLORS,
  GRAB_SPACE,
  LINE_HEIGHT,
  METERS_PER_PIXEL,
  PADDING,
  PIXEL_RATIO,
  TEXT_SIZE,
  TITLE_SIZE,
  drawCloseButton,
  drawGrabBar,
  drawText,
  font,
  isOnCloseButton,
  isOnGrabBar,
} from "./panelStyle";

// Layout, in layout pixels. Rows are taller than the page's 34px so a ray can pick one easily.
const WIDTH = 400;
const HEIGHT = 860;
const INNER_WIDTH = WIDTH - 2 * PADDING;
const CLOSE_X = WIDTH - PADDING - CLOSE_SIZE;
const CLOSE_Y = PADDING;
// 0.85rem, the page's control and row text.
const CONTROL_TEXT_SIZE = 15.3;
const SEARCH_TOP = PADDING + CLOSE_SIZE + 12;
const SEARCH_HEIGHT = 40;
const FIELD_GAP = 12;
const LABEL_HEIGHT = TEXT_SIZE * LINE_HEIGHT;
const LABEL_GAP = 4;
// The Clear filters link's hit area reaches this far above and below its line.
const LINK_SLOP = 6;
const CHIP_HEIGHT = 32;
const CHIP_GAP = 6;
const CHIP_PADDING_X = 12;
// The launch year slider: its hit area's height, the track's thickness, and the handles' radius.
const SLIDER_HEIGHT = 32;
const TRACK_HEIGHT = 4;
const HANDLE_RADIUS = 10;
const SLIDER_LEFT = PADDING + HANDLE_RADIUS;
const SLIDER_RIGHT = WIDTH - PADDING - HANDLE_RADIUS;
const ROW_HEIGHT = 40;
const ROW_PADDING_X = 8;
const SCROLLBAR_WIDTH = 4;
const SCROLLBAR_MIN_HEIGHT = 24;
// The rows leave a gutter on the right for the scrollbar.
const ROWS_RIGHT = WIDTH - PADDING - SCROLLBAR_WIDTH - 6;
const LAYER_HEIGHT = HEIGHT + GRAB_SPACE;

type ChipFilter = "objectType" | "size";

/** A part of the list that reacts to the ray. */
export type ListTarget =
  | { kind: "close" }
  | { kind: "search" }
  | { kind: "clear" }
  | { kind: "slider" }
  | { kind: "chip"; filter: ChipFilter; value: string }
  | { kind: "row"; satelliteId: number };

function targetKey(target: ListTarget) {
  switch (target.kind) {
    case "chip":
      return `chip:${target.filter}:${target.value}`;
    case "row":
      return `row:${target.satelliteId}`;
    default:
      return target.kind;
  }
}

export interface ListHit {
  // The grab bar moves the panel; everything else is the list's own.
  region: "grab" | "list";
  target: ListTarget | null;
  key: string | null;
  // Where the ray meets the panel, in layout pixels from its left.
  x: number;
  local: Vector3;
  distance: number;
}

/** What the list does in response to the user, wired up by its owner. */
export interface ListCallbacks {
  onSelect: (id: number) => void;
  onClose: () => void;
  onFiltersChange: (patch: Partial<SatelliteFilters>) => void;
  onFiltersReset: () => void;
}

interface Chip {
  target: Extract<ListTarget, { kind: "chip" }>;
  label: string;
  x: number;
  y: number;
  width: number;
}

function yearAt(x: number) {
  const t = Math.min(
    1,
    Math.max(0, (x - SLIDER_LEFT) / (SLIDER_RIGHT - SLIDER_LEFT))
  );
  return Math.round(FIRST_LAUNCH_YEAR + t * (CURRENT_YEAR - FIRST_LAUNCH_YEAR));
}

function sliderX(year: number) {
  return (
    SLIDER_LEFT +
    ((year - FIRST_LAUNCH_YEAR) / (CURRENT_YEAR - FIRST_LAUNCH_YEAR)) *
      (SLIDER_RIGHT - SLIDER_LEFT)
  );
}

/**
 * The XR version of SatelliteList with its SatelliteFilterBar: search, type and size chips (the
 * page's dropdowns), a launch year range slider (the page's year fields), and the (filtered)
 * satellites as rows, drawn on a WebXR layer placed in the room.
 *
 * Like the page's list it is virtualized, though here it comes for free: each draw paints only
 * the rows in view at the scroll offset, so there are no per-row objects and the list's length
 * never affects frame time. Rows map to hits arithmetically; the other controls are hit regions
 * placed by `layout`, which both drawing and hit testing use, so the two never disagree.
 *
 * Search types into a hidden DOM input, which brings up the headset's system keyboard while a
 * session is running (Quest Browser 26.1+); in the emulator the computer's keyboard types into it.
 */
export function createXRSatelliteList(
  renderer: WebGPURenderer,
  position: Vector3,
  quaternion: Quaternion,
  callbacks: ListCallbacks
) {
  let satellites: SatelliteInfo[] = [];
  let totalCount = 0;
  let loading = true;
  let filters: SatelliteFilters | null = null;
  let options: FilterOptions = { objectTypes: [], sizes: [] };
  let selectedId: number | null = null;
  // Layout pixels scrolled past the top of the rows.
  let scrollTop = 0;
  let open = false;
  let hoveredKey: string | null = null;
  let grabHighlighted = false;
  // The key of the control a trigger press started on; it acts on release if still on it.
  let pressedKey: string | null = null;
  // The years shown while a slider handle is dragged; they apply on release, so a drag doesn't
  // refilter 32k satellites on every frame.
  let sliderDrag: { handle: "from" | "to"; from: number; to: number } | null =
    null;
  // The years a released drag applied, shown until the new filters come back. App refilters and
  // re-renders before they do, and in between the old filters would snap the handles back.
  let pendingYears: { from: number; to: number } | null = null;
  // The search text as typed, and the pending debounced update of the filter from it.
  let searchText = "";
  let searchFocused = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const layer = createCanvasLayer(renderer, {
    width: WIDTH,
    height: LAYER_HEIGHT,
    pixelRatio: PIXEL_RATIO,
    metersPerPixel: METERS_PER_PIXEL,
    position,
    quaternion,
    draw,
  });

  // The hidden input the system keyboard types into. It has to be in the DOM and focusable.
  const input = document.createElement("input");
  input.type = "search";
  input.setAttribute("aria-label", "Search by name or ID");
  Object.assign(input.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(input);

  function handleInput() {
    // The system keyboard replaces the whole value each time, so take all of it.
    searchText = input.value;
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      callbacks.onFiltersChange({ query: searchText.trim() });
    }, SEARCH_DEBOUNCE_MS);
    layer.invalidate();
  }
  function handleFocusChange() {
    searchFocused = document.activeElement === input;
    layer.invalidate();
  }
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === "Escape") input.blur();
  }
  input.addEventListener("input", handleInput);
  input.addEventListener("focus", handleFocusChange);
  input.addEventListener("blur", handleFocusChange);
  input.addEventListener("keydown", handleKeyDown);

  // Layout of the controls, which only changes with the filter options (the chips wrap).
  const measure = document.createElement("canvas").getContext("2d")!;
  let chips: Chip[] = [];
  let typeLabelY = 0;
  let sizeLabelY = 0;
  let yearLabelY = 0;
  let sliderY = 0;
  let rowsTop = 0;
  let rowsHeight = 0;

  function layoutChips(filter: ChipFilter, values: string[], top: number) {
    let x = PADDING;
    let y = top;
    measure.font = font(TEXT_SIZE);
    for (const value of ["", ...values]) {
      const label = value === "" ? "All" : sentenceCase(value);
      const width = measure.measureText(label).width + 2 * CHIP_PADDING_X;
      if (x > PADDING && x + width > WIDTH - PADDING) {
        x = PADDING;
        y += CHIP_HEIGHT + CHIP_GAP;
      }
      chips.push({
        target: { kind: "chip", filter, value },
        label,
        x,
        y,
        width,
      });
      x += width + CHIP_GAP;
    }
    return y + CHIP_HEIGHT;
  }

  function layout() {
    chips = [];
    let y = SEARCH_TOP + SEARCH_HEIGHT + FIELD_GAP;
    typeLabelY = y;
    y =
      layoutChips(
        "objectType",
        options.objectTypes,
        y + LABEL_HEIGHT + LABEL_GAP
      ) + FIELD_GAP;
    sizeLabelY = y;
    y =
      layoutChips("size", options.sizes, y + LABEL_HEIGHT + LABEL_GAP) +
      FIELD_GAP;
    yearLabelY = y;
    sliderY = y + LABEL_HEIGHT + LABEL_GAP;
    rowsTop = sliderY + SLIDER_HEIGHT + FIELD_GAP;
    rowsHeight = HEIGHT - PADDING - rowsTop;
    setScrollTop(scrollTop);
  }
  layout();

  function clearWidth() {
    measure.font = font(TEXT_SIZE);
    return measure.measureText("Clear filters").width;
  }

  /** Whether anything is filtered, or about to be, like the page's Clear filters condition. */
  function filtering() {
    return (
      (filters !== null && isFiltering(filters)) ||
      searchText !== "" ||
      sliderDrag !== null
    );
  }

  function years() {
    if (sliderDrag) return { from: sliderDrag.from, to: sliderDrag.to };
    if (pendingYears) return pendingYears;
    return {
      from: filters?.yearFrom ?? FIRST_LAUNCH_YEAR,
      to: filters?.yearTo ?? CURRENT_YEAR,
    };
  }

  function maxScrollTop() {
    return Math.max(0, satellites.length * ROW_HEIGHT - rowsHeight);
  }

  function setScrollTop(value: number) {
    const next = Math.min(maxScrollTop(), Math.max(0, value));
    if (next === scrollTop) return;
    scrollTop = next;
    layer.invalidate();
  }

  /** Scrolls just enough to bring the selected satellite's row into view, if it is listed. */
  function revealSelected() {
    if (selectedId === null) return;
    const index = satellites.findIndex((s) => s.id === selectedId);
    if (index === -1) return;
    const top = index * ROW_HEIGHT;
    if (top < scrollTop) setScrollTop(top);
    else if (top + ROW_HEIGHT > scrollTop + rowsHeight)
      setScrollTop(top + ROW_HEIGHT - rowsHeight);
  }

  /** A rounded control box, like .satellite-filters__control. */
  function drawControl(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    state: { selected?: boolean; hovered?: boolean; focused?: boolean }
  ) {
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, width - 1, height - 1, 8);
    ctx.fillStyle = state.selected ? COLORS.selected : COLORS.field;
    ctx.fill();
    if (state.hovered && !state.selected) {
      ctx.fillStyle = COLORS.hover;
      ctx.fill();
    }
    ctx.strokeStyle = state.focused
      ? COLORS.focus
      : state.selected
        ? COLORS.selectedBorder
        : COLORS.fieldBorder;
    ctx.lineWidth = state.focused ? 2 : 1;
    ctx.stroke();
  }

  function drawSearch(ctx: CanvasRenderingContext2D) {
    drawControl(ctx, PADDING, SEARCH_TOP, INNER_WIDTH, SEARCH_HEIGHT, {
      hovered: hoveredKey === "search",
      focused: searchFocused,
    });
    const textX = PADDING + 12;
    const textY =
      SEARCH_TOP + (SEARCH_HEIGHT - CONTROL_TEXT_SIZE * LINE_HEIGHT) / 2;
    const maxWidth = INNER_WIDTH - 24;
    if (searchText) {
      ctx.fillStyle = COLORS.text;
      drawText(ctx, searchText, textX, textY, CONTROL_TEXT_SIZE, 400, maxWidth);
    } else {
      ctx.fillStyle = COLORS.muted;
      drawText(ctx, "Search name or ID", textX, textY, CONTROL_TEXT_SIZE);
    }
    if (searchFocused) {
      // A steady caret after the text; blinking would redraw the panel twice a second.
      ctx.font = font(CONTROL_TEXT_SIZE);
      const caretX =
        textX +
        Math.min(maxWidth, searchText ? ctx.measureText(searchText).width : 0) +
        1;
      ctx.fillStyle = COLORS.focus;
      ctx.fillRect(caretX, textY + 2, 1.5, CONTROL_TEXT_SIZE * LINE_HEIGHT - 4);
    }
  }

  function drawSlider(ctx: CanvasRenderingContext2D) {
    const { from, to } = years();
    ctx.fillStyle = COLORS.muted;
    drawText(ctx, "Launched", PADDING, yearLabelY, TEXT_SIZE);
    ctx.font = font(TEXT_SIZE);
    const range = `${from} – ${to}`;
    ctx.fillStyle = COLORS.text;
    drawText(
      ctx,
      range,
      WIDTH - PADDING - ctx.measureText(range).width,
      yearLabelY,
      TEXT_SIZE
    );

    const centerY = sliderY + SLIDER_HEIGHT / 2;
    const fromX = sliderX(from);
    const toX = sliderX(to);
    ctx.fillStyle = COLORS.track;
    ctx.beginPath();
    ctx.roundRect(
      SLIDER_LEFT,
      centerY - TRACK_HEIGHT / 2,
      SLIDER_RIGHT - SLIDER_LEFT,
      TRACK_HEIGHT,
      TRACK_HEIGHT / 2
    );
    ctx.fill();
    ctx.fillStyle = COLORS.focus;
    ctx.fillRect(fromX, centerY - TRACK_HEIGHT / 2, toX - fromX, TRACK_HEIGHT);

    // The handles grow under a ray, and the dragged one stays grown.
    for (const handle of ["from", "to"] as const) {
      const active = sliderDrag
        ? sliderDrag.handle === handle
        : hoveredKey === "slider";
      ctx.fillStyle = COLORS.text;
      ctx.beginPath();
      ctx.arc(
        handle === "from" ? fromX : toX,
        centerY,
        HANDLE_RADIUS + (active ? 2 : 0),
        0,
        2 * Math.PI
      );
      ctx.fill();
    }
  }

  function drawRow(
    ctx: CanvasRenderingContext2D,
    satellite: SatelliteInfo,
    y: number
  ) {
    const selected = satellite.id === selectedId;
    if (selected || hoveredKey === `row:${satellite.id}`) {
      ctx.fillStyle = selected ? COLORS.selected : COLORS.rowHover;
      ctx.fillRect(PADDING, y, ROWS_RIGHT - PADDING, ROW_HEIGHT);
    }
    ctx.fillStyle = selected ? COLORS.selectedBorder : COLORS.rowBorder;
    ctx.fillRect(PADDING, y + ROW_HEIGHT - 1, ROWS_RIGHT - PADDING, 1);

    const textY = y + (ROW_HEIGHT - CONTROL_TEXT_SIZE * LINE_HEIGHT) / 2;
    const id = String(satellite.id);
    ctx.font = font(CONTROL_TEXT_SIZE);
    const idX = ROWS_RIGHT - ROW_PADDING_X - ctx.measureText(id).width;
    ctx.fillStyle = COLORS.muted;
    drawText(ctx, id, idX, textY, CONTROL_TEXT_SIZE);
    ctx.fillStyle = COLORS.text;
    const nameX = PADDING + ROW_PADDING_X;
    drawText(
      ctx,
      satellite.name,
      nameX,
      textY,
      CONTROL_TEXT_SIZE,
      400,
      idX - 12 - nameX
    );
  }

  function drawRows(ctx: CanvasRenderingContext2D) {
    const message = loading
      ? "Loading satellites..."
      : satellites.length === 0
        ? totalCount > 0
          ? "No satellites match your filters."
          : "No satellites found."
        : null;
    if (message) {
      ctx.fillStyle = COLORS.muted;
      drawText(ctx, message, PADDING, rowsTop, TEXT_SIZE);
      return;
    }

    // Only the rows in view are drawn, clipped so partly scrolled rows are cut at the edges.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADDING, rowsTop, ROWS_RIGHT - PADDING, rowsHeight);
    ctx.clip();
    const first = Math.floor(scrollTop / ROW_HEIGHT);
    const end = Math.min(
      satellites.length,
      Math.ceil((scrollTop + rowsHeight) / ROW_HEIGHT)
    );
    for (let i = first; i < end; i++) {
      drawRow(ctx, satellites[i], rowsTop + i * ROW_HEIGHT - scrollTop);
    }
    ctx.restore();

    // A scrollbar showing where the view is in the list; it is not interactive yet.
    const max = maxScrollTop();
    if (max > 0) {
      const contentHeight = satellites.length * ROW_HEIGHT;
      const thumbHeight = Math.max(
        SCROLLBAR_MIN_HEIGHT,
        (rowsHeight * rowsHeight) / contentHeight
      );
      const thumbY = rowsTop + ((rowsHeight - thumbHeight) * scrollTop) / max;
      ctx.fillStyle = COLORS.scrollbar;
      ctx.beginPath();
      ctx.roundRect(
        WIDTH - PADDING - SCROLLBAR_WIDTH,
        thumbY,
        SCROLLBAR_WIDTH,
        thumbHeight,
        SCROLLBAR_WIDTH / 2
      );
      ctx.fill();
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = COLORS.background;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1, 12);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Header: the title with the count, as on the page, and the close button.
    const title = loading
      ? "Satellites"
      : satellites.length === totalCount
        ? `Satellites (${totalCount})`
        : `Satellites (${satellites.length} of ${totalCount})`;
    ctx.fillStyle = COLORS.text;
    drawText(
      ctx,
      title,
      PADDING,
      CLOSE_Y + (CLOSE_SIZE - TITLE_SIZE * LINE_HEIGHT) / 2,
      TITLE_SIZE,
      600,
      CLOSE_X - 8 - PADDING
    );
    drawCloseButton(ctx, CLOSE_X, CLOSE_Y, hoveredKey === "close");

    drawSearch(ctx);

    ctx.fillStyle = COLORS.muted;
    drawText(ctx, "Type", PADDING, typeLabelY, TEXT_SIZE);
    drawText(ctx, "Size", PADDING, sizeLabelY, TEXT_SIZE);
    // Clear filters sits on the Type line, so showing it never moves the rows.
    if (filtering()) {
      ctx.fillStyle = hoveredKey === "clear" ? COLORS.text : COLORS.focus;
      drawText(
        ctx,
        "Clear filters",
        WIDTH - PADDING - clearWidth(),
        typeLabelY,
        TEXT_SIZE
      );
    }
    for (const chip of chips) {
      const selected =
        filters !== null && filters[chip.target.filter] === chip.target.value;
      drawControl(ctx, chip.x, chip.y, chip.width, CHIP_HEIGHT, {
        selected,
        hovered: hoveredKey === targetKey(chip.target),
      });
      ctx.fillStyle = selected ? COLORS.text : COLORS.buttonText;
      drawText(
        ctx,
        chip.label,
        chip.x + CHIP_PADDING_X,
        chip.y + (CHIP_HEIGHT - LABEL_HEIGHT) / 2,
        TEXT_SIZE
      );
    }
    drawSlider(ctx);

    drawRows(ctx);

    drawGrabBar(ctx, WIDTH, HEIGHT, grabHighlighted);
  }

  /** Updates the rows, the count, and whether they are still loading; cheap when unchanged. */
  function setSatellites(
    next: SatelliteInfo[],
    nextTotalCount: number,
    nextLoading: boolean
  ) {
    if (
      next === satellites &&
      nextTotalCount === totalCount &&
      nextLoading === loading
    )
      return;
    const changed = next !== satellites;
    satellites = next;
    totalCount = nextTotalCount;
    loading = nextLoading;
    // Keep the scroll offset, as the page does, clamped to the new length, then bring the
    // selection back into view.
    setScrollTop(scrollTop);
    if (changed) revealSelected();
    layer.invalidate();
  }

  /** Updates the applied filters and the choices for the chips; cheap when unchanged. */
  function setFilters(next: SatelliteFilters, nextOptions: FilterOptions) {
    if (next === filters && nextOptions === options) return;
    // Any new filters are the applied years coming back, or something newer (a reset) that wins.
    if (next !== filters) pendingYears = null;
    filters = next;
    if (nextOptions !== options) {
      options = nextOptions;
      layout();
    }
    // Follow a query set elsewhere (the page's search, or a reset), unless the user is typing.
    if (
      searchTimer === null &&
      !searchFocused &&
      next.query !== searchText.trim()
    ) {
      searchText = next.query;
      input.value = next.query;
    }
    layer.invalidate();
  }

  /** Highlights the selected satellite's row and scrolls it into view, like the page's list. */
  function setSelected(id: number | null) {
    if (id === selectedId) return;
    selectedId = id;
    revealSelected();
    layer.invalidate();
  }

  /** Scrolls the rows by this many layout pixels (positive is down the list). */
  function scrollBy(pixels: number) {
    setScrollTop(scrollTop + pixels);
  }

  function setOpen(next: boolean) {
    if (next === open) return;
    open = next;
    hoveredKey = null;
    grabHighlighted = false;
    cancelPointer();
    if (!next) input.blur();
    layer.setVisible(next);
    layer.invalidate();
  }

  /**
   * What the ray points at on the list, with the point it meets in `object`'s space and the
   * distance to it; null if it misses the list and its grab bar, or the list is closed.
   */
  function hitTest(raycaster: Raycaster): ListHit | null {
    const hit = layer.hitTest(raycaster);
    if (!hit) return null;
    const { x, y, local, distance } = hit;
    const result = (
      region: ListHit["region"],
      target: ListTarget | null
    ): ListHit => ({
      region,
      target,
      key: target && targetKey(target),
      x,
      local,
      distance,
    });
    if (y > HEIGHT)
      return isOnGrabBar(x, y, WIDTH, HEIGHT) ? result("grab", null) : null;
    if (isOnCloseButton(x, y, CLOSE_X, CLOSE_Y))
      return result("list", { kind: "close" });
    const inside = (left: number, top: number, width: number, height: number) =>
      x >= left && x <= left + width && y >= top && y <= top + height;
    if (inside(PADDING, SEARCH_TOP, INNER_WIDTH, SEARCH_HEIGHT)) {
      return result("list", { kind: "search" });
    }
    const clear = clearWidth();
    if (
      filtering() &&
      inside(
        WIDTH - PADDING - clear,
        typeLabelY - LINK_SLOP,
        clear,
        LABEL_HEIGHT + 2 * LINK_SLOP
      )
    ) {
      return result("list", { kind: "clear" });
    }
    for (const chip of chips) {
      if (inside(chip.x, chip.y, chip.width, CHIP_HEIGHT))
        return result("list", chip.target);
    }
    if (inside(PADDING, sliderY, INNER_WIDTH, SLIDER_HEIGHT)) {
      return result("list", { kind: "slider" });
    }
    if (
      !loading &&
      inside(PADDING, rowsTop, ROWS_RIGHT - PADDING, rowsHeight)
    ) {
      const satellite =
        satellites[Math.floor((y - rowsTop + scrollTop) / ROW_HEIGHT)];
      if (satellite)
        return result("list", { kind: "row", satelliteId: satellite.id });
    }
    return result("list", null);
  }

  /** Highlights what the rays point at, by hit key, and the grab bar. */
  function setHover(key: string | null, grab: boolean) {
    if (key === hoveredKey && grab === grabHighlighted) return;
    hoveredKey = key;
    grabHighlighted = grab;
    layer.invalidate();
  }

  /** Moves the dragged slider handle to the year under `x`, keeping the range in order. */
  function dragSliderTo(x: number) {
    if (!sliderDrag) return;
    const year = yearAt(x);
    if (sliderDrag.handle === "from")
      sliderDrag.from = Math.min(year, sliderDrag.to);
    else sliderDrag.to = Math.max(year, sliderDrag.from);
    layer.invalidate();
  }

  /** A trigger press on the list (not its grab bar). */
  function pointerDown(hit: ListHit) {
    pressedKey = hit.key;
    if (hit.target?.kind === "slider") {
      // The handle nearer the press moves to it, so a press on the track jumps there too.
      const { from, to } = years();
      const year = yearAt(hit.x);
      const handle =
        year <= from
          ? "from"
          : year >= to
            ? "to"
            : year - from < to - year
              ? "from"
              : "to";
      sliderDrag = { handle, from, to };
      dragSliderTo(hit.x);
    }
  }

  /** The pressing ray's latest hit on the list while the trigger is held, or null if it left. */
  function pointerMove(hit: ListHit | null) {
    if (sliderDrag && hit?.region === "list") dragSliderTo(hit.x);
  }

  /** The trigger's release, with what the ray points at then. */
  function pointerUp(hit: ListHit | null) {
    const pressed = pressedKey;
    pressedKey = null;
    if (sliderDrag) {
      const { from, to } = sliderDrag;
      sliderDrag = null;
      // The ends of the range mean no limit, so satellites with unknown years stay listed.
      const yearFrom = from === FIRST_LAUNCH_YEAR ? null : from;
      const yearTo = to === CURRENT_YEAR ? null : to;
      // App keeps its filters when nothing changed, so only wait for a change it will make.
      if (yearFrom !== filters?.yearFrom || yearTo !== filters?.yearTo)
        pendingYears = { from, to };
      callbacks.onFiltersChange({ yearFrom, yearTo });
      layer.invalidate();
      return;
    }
    if (!hit?.target || hit.key !== pressed) return;
    const target = hit.target;
    switch (target.kind) {
      case "close":
        callbacks.onClose();
        break;
      case "search":
        // Focusing during a session brings up the system keyboard; the trigger's release counts
        // as the user activation it needs.
        input.focus();
        break;
      case "clear":
        if (searchTimer !== null) clearTimeout(searchTimer);
        searchTimer = null;
        searchText = "";
        input.value = "";
        callbacks.onFiltersReset();
        layer.invalidate();
        break;
      case "chip": {
        // Pressing the chosen chip again goes back to All.
        const current = filters?.[target.filter] ?? "";
        callbacks.onFiltersChange({
          [target.filter]: current === target.value ? "" : target.value,
        });
        break;
      }
      case "row":
        callbacks.onSelect(target.satelliteId);
        break;
    }
  }

  /** Drops a press in progress without acting on it, discarding a slider drag. */
  function cancelPointer() {
    pressedKey = null;
    if (sliderDrag) {
      sliderDrag = null;
      layer.invalidate();
    }
  }

  function dispose() {
    if (searchTimer !== null) clearTimeout(searchTimer);
    input.removeEventListener("input", handleInput);
    input.removeEventListener("focus", handleFocusChange);
    input.removeEventListener("blur", handleFocusChange);
    input.removeEventListener("keydown", handleKeyDown);
    input.remove();
    layer.dispose();
  }

  return {
    object: layer.object,
    setUsesLayers: layer.setUsesLayers,
    setSatellites,
    setFilters,
    setSelected,
    scrollBy,
    setOpen,
    isOpen: () => open,
    hitTest,
    setHover,
    pointerDown,
    pointerMove,
    pointerUp,
    cancelPointer,
    update: layer.update,
    dispose,
  };
}

export type XRSatelliteList = ReturnType<typeof createXRSatelliteList>;
