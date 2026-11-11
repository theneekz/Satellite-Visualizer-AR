import "./SheetHandle.css";

/**
 * The grab bar at the top of a phone bottom sheet. Tapping it, or activating it with the keyboard,
 * calls onTap. Dragging comes from useSheetDrag, spread on the handle or on an area around it.
 * Hidden on wider screens, where the panels aren't sheets.
 */
function SheetHandle({
  label,
  expanded,
  onTap,
}: {
  // What a tap does, for screen readers.
  label: string;
  // Set when tapping toggles between a short and a tall state.
  expanded?: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onTap}
    >
      <span className="sheet-handle__bar" />
    </button>
  );
}

export default SheetHandle;
