/**
 * Fits the page to the part of the screen the browser's toolbars actually leave visible.
 *
 * iOS Safari can lose track of its own toolbar after the keyboard closes: the page grows as if the
 * bottom toolbar had collapsed while the toolbar stays on screen, so it covers the bottom
 * navigation bar. The visual viewport still reports the true visible area, so this copies its
 * height and top offset into the --app-height and --app-top CSS variables, which size the body in
 * index.css.
 */
export function trackVisibleViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const root = document.documentElement;

  function update() {
    // While the keyboard is open the visible area shrinks to the space above it. Keep the last
    // size so the sheet and navigation bar don't jump up over the keyboard.
    if (isEditingText()) return;
    root.style.setProperty("--app-height", `${viewport!.height}px`);
    root.style.setProperty("--app-top", `${viewport!.offsetTop}px`);
  }

  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  // The keyboard closes after the field loses focus, and Safari doesn't always send a resize
  // event once it settles, so check again after its closing animation.
  document.addEventListener("focusout", () => {
    requestAnimationFrame(update);
    setTimeout(update, 400);
  });
}

function isEditingText() {
  const element = document.activeElement;
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "range", "submit"].includes(
        element.type
      ))
  );
}
