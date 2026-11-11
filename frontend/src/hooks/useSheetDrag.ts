import {
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { PHONE_QUERY } from "../constants";

// How far, in pixels, the pointer must move before a press counts as a drag instead of a tap.
const TAP_SLOP = 6;

/**
 * Lets the user drag a phone bottom sheet by any element the returned handlers are spread on,
 * such as its handle or its whole title area. The sheet follows the pointer, then onDragEnd
 * receives how far the pointer moved (negative is up) so the sheet can pick its next state.
 *
 * A press that doesn't move past a few pixels stays an ordinary tap, so buttons and tooltips in
 * the drag area keep working. Wider screens don't show sheets, so there the handlers do nothing.
 */
export function useSheetDrag({
  sheetRef,
  canGrow,
  dragFrom,
  onDragEnd,
}: {
  sheetRef: RefObject<HTMLElement | null>;
  // Whether dragging up may stretch the sheet. A sheet that's already as tall as it gets can't.
  canGrow: boolean;
  // A CSS selector for the parts that start a drag, when only some of the element should.
  dragFrom?: string;
  onDragEnd: (deltaY: number) => void;
}) {
  // Set while a pointer is down in the drag area.
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);
  // Set when a drag just ended, so the click the browser fires afterward is ignored.
  const justDragged = useRef(false);

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    const sheet = sheetRef.current;
    if (!sheet || !window.matchMedia(PHONE_QUERY).matches) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (
      dragFrom &&
      !(e.target instanceof Element && e.target.closest(dragFrom))
    ) {
      return;
    }
    // The drag belongs to the sheet, so nothing behind it should react.
    e.stopPropagation();
    justDragged.current = false;
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      moved: false,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const sheet = sheetRef.current;
    const state = drag.current;
    if (!sheet || !state || e.pointerId !== state.pointerId) return;
    const deltaY = e.clientY - state.startY;
    if (!state.moved) {
      if (Math.abs(deltaY) < TAP_SLOP) return;
      state.moved = true;
      // Captured only once it's a drag: capturing on press would send the click to the drag area
      // instead of a button inside it.
      e.currentTarget.setPointerCapture(e.pointerId);
      // The sheet follows the pointer without easing while it's held.
      sheet.classList.add("is-dragging");
    }
    if (deltaY > 0) {
      // Dragging down slides the whole sheet down rather than squashing its content.
      sheet.style.height = "";
      sheet.style.transform = `translateY(${deltaY}px)`;
    } else if (canGrow) {
      // Dragging up stretches the sheet, up to the tallest it can be.
      const maxHeight = window.innerHeight - 64;
      sheet.style.transform = "";
      sheet.style.height = `${Math.min(state.startHeight - deltaY, maxHeight)}px`;
    }
  }

  function finish(e: PointerEvent<HTMLElement>, cancelled: boolean) {
    const sheet = sheetRef.current;
    const state = drag.current;
    if (!sheet || !state || e.pointerId !== state.pointerId) return;
    drag.current = null;
    if (!state.moved) return;
    justDragged.current = true;
    sheet.classList.remove("is-dragging");
    sheet.style.transform = "";
    sheet.style.height = "";
    if (!cancelled) onDragEnd(e.clientY - state.startY);
  }

  function onClickCapture(e: MouseEvent<HTMLElement>) {
    if (!justDragged.current) return;
    justDragged.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: PointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => finish(e, true),
    onClickCapture,
  };
}
