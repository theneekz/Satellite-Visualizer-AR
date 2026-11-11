import { useEffect, type RefObject } from "react";

/**
 * Keeps touch drags on a bottom sheet from reaching the page. Without this, dragging the sheet's
 * handle or header down can pull the whole page and trigger Safari's pull to refresh.
 *
 * Drags inside an element matching scrollAreaSelector still scroll it, as long as it has content
 * to scroll. Give that element `overscroll-behavior: contain` so a scroll that hits its end
 * doesn't carry on to the page.
 */
export function useContainTouches(
  ref: RefObject<HTMLElement | null>,
  scrollAreaSelector: string
) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    function handleTouchMove(e: TouchEvent) {
      e.stopPropagation();
      const scrollArea =
        e.target instanceof Element
          ? e.target.closest(scrollAreaSelector)
          : null;
      if (!scrollArea || scrollArea.scrollHeight <= scrollArea.clientHeight) {
        e.preventDefault();
      }
    }
    // React's touch listeners are passive, and a passive listener can't cancel the page scroll.
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => element.removeEventListener("touchmove", handleTouchMove);
  }, [ref, scrollAreaSelector]);
}
