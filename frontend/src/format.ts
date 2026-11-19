/** 100000 -> "100,000". Fixed to en-US so the separator does not depend on the viewer's locale. */
export function formatCount(count: number) {
  return count.toLocaleString("en-US");
}

/** [1, 0.5, 0] (RGB, 0 to 1) -> "rgb(255 128 0)". */
export function cssColor([r, g, b]: readonly [number, number, number]) {
  const byte = (channel: number) => Math.round(channel * 255);
  return `rgb(${byte(r)} ${byte(g)} ${byte(b)})`;
}

/** "ROCKET BODY" -> "Rocket body". */
export function sentenceCase(text: string) {
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
