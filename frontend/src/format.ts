/** 100000 -> "100,000". Fixed to en-US so the separator does not depend on the viewer's locale. */
export function formatCount(count: number) {
  return count.toLocaleString("en-US");
}

/** "ROCKET BODY" -> "Rocket body". */
export function sentenceCase(text: string) {
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
