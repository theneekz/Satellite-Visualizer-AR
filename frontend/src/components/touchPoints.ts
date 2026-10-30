type Point = { x: number; y: number };

// Tracks every active touch so the globe can pinch-zoom with two fingers. Pointer events report
// one pointer at a time, so a pinch needs the position of each finger.
export class TouchPoints {
  private points = new Map<number, Point>();
  private distance = 0;

  get size(): number {
    return this.points.size;
  }

  // The position of the only pointer left, so a drag can resume where the remaining finger is.
  only(): Point | undefined {
    return this.points.values().next().value;
  }

  add(e: PointerEvent) {
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.distance = this.pinchDistance();
  }

  remove(e: PointerEvent) {
    this.points.delete(e.pointerId);
    this.distance = this.pinchDistance();
  }

  // Records the pointer's new position. While two fingers are down, returns how much the gap
  // between them grew (above 1) or shrank (below 1) since the last move. Otherwise returns 1.
  move(e: PointerEvent): number {
    const point = this.points.get(e.pointerId);
    if (!point) return 1;
    point.x = e.clientX;
    point.y = e.clientY;
    if (this.points.size !== 2) return 1;
    const distance = this.pinchDistance();
    const factor = this.distance > 0 ? distance / this.distance : 1;
    this.distance = distance;
    return factor;
  }

  private pinchDistance(): number {
    if (this.points.size !== 2) return 0;
    const [a, b] = this.points.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
