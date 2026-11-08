import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

// Minimum distance from the viewport edges and from the element the tooltip describes.
const MARGIN_PX = 8;

/**
 * Shows `text` on mouse hover, keyboard focus, or tap.
 *
 * The bubble renders in document.body because the satellite card scrolls, which would clip it, and
 * has a backdrop-filter, which would make position: fixed relative to the card.
 */
function Tooltip({
  text,
  as: Element = "span",
  className,
  children,
}: {
  text: string;
  as?: "span" | "div";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLElement & HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Positions the bubble before paint: above the trigger, or below it when there's no room above.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!open || !trigger || !bubble) return;
    const anchor = trigger.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const above = anchor.top - height - MARGIN_PX;
    const top = above >= MARGIN_PX ? above : anchor.bottom + MARGIN_PX;
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.max(
      MARGIN_PX,
      Math.min(centered, window.innerWidth - width - MARGIN_PX)
    );
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    // Touch screens have no "pointer left" event, so a tap elsewhere closes the bubble.
    function closeIfOutside(e: PointerEvent) {
      if (!triggerRef.current?.contains(e.target as Node)) close();
    }
    // Capture is required because scroll events from the card don't bubble to window.
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", closeIfOutside);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", closeIfOutside);
    };
  }, [open]);

  return (
    <>
      <Element
        ref={triggerRef}
        className={
          className ? `tooltip-trigger ${className}` : "tooltip-trigger"
        }
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setOpen(false);
        }}
        // A drag that scrolls the card fires pointercancel instead of pointerup, so it won't toggle.
        onPointerUp={(e) => {
          if (e.pointerType !== "mouse") setOpen((isOpen) => !isOpen);
        }}
        // Only keyboard focus counts. A tap also focuses, and would undo the pointerup toggle.
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </Element>
      {open &&
        createPortal(
          <div ref={bubbleRef} id={id} role="tooltip" className="tooltip">
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

export default Tooltip;
