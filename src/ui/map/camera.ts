import type { Point } from '../../engine/types';
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface Camera {
  x: number;
  y: number;
  k: number;
  width: number;
  height: number;
}
export const boundsOf = (points: readonly Point[]): Bounds => ({
  minX: Math.min(-350, ...points.map((p) => p.x)) - 100,
  minY: Math.min(-200, ...points.map((p) => p.y)) - 100,
  maxX: Math.max(500, ...points.map((p) => p.x)) + 100,
  maxY: Math.max(200, ...points.map((p) => p.y)) + 100,
});
export function fitCamera(
  width: number,
  height: number,
  b: Bounds = { minX: -450, minY: -300, maxX: 600, maxY: 300 },
): Camera {
  const k = Math.max(0.02, Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY)) * 0.9);
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    k,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}
export const clampCamera = (c: Camera): Camera => ({ ...c, k: Math.max(0.02, Math.min(12, c.k)) });
export const project = (p: Point, c: Camera): Point => ({
  x: c.width / 2 + (p.x - c.x) * c.k,
  y: c.height / 2 + (p.y - c.y) * c.k,
});
export const unproject = (p: Point, c: Camera): Point => ({
  x: c.x + (p.x - c.width / 2) / c.k,
  y: c.y + (p.y - c.height / 2) / c.k,
});
export function zoomCamera(c: Camera, k: number, p: Point) {
  const anchor = unproject(p, c),
    next = clampCamera({ ...c, k });
  return {
    ...next,
    x: anchor.x - (p.x - c.width / 2) / next.k,
    y: anchor.y - (p.y - c.height / 2) / next.k,
  };
}
export const resizeCamera = (c: Camera, width: number, height: number) => ({
  ...c,
  width: Math.max(1, width),
  height: Math.max(1, height),
});
export const focusCamera = (c: Camera, p: Point) => ({
  ...c,
  x: p.x,
  y: p.y,
  k: Math.max(0.85, c.k),
});
export interface MapLabel extends Point {
  id: string;
  text: string;
  priority: number;
  color: string;
  width?: number;
  height?: number;
}
export interface LabelObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function placeLabels(
  labels: MapLabel[],
  width: number,
  height: number,
  scale = 1,
  obstacles: LabelObstacle[] = [],
) {
  const placed: (MapLabel & { width: number; height: number; anchor: Point })[] = [];
  const occupied: LabelObstacle[] = [...obstacles];
  const intersects = (a: LabelObstacle, b: LabelObstacle) =>
    a.x < b.x + b.width + 4 &&
    a.x + a.width + 4 > b.x &&
    a.y < b.y + b.height + 4 &&
    a.y + a.height + 4 > b.y;
  for (const l of [...labels].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const w =
      l.width ??
      [...l.text].reduce((n, ch) => n + (/[\u2e80-\uffff]/.test(ch) ? 14 : 6.8), 8) * scale;
    const h = l.height ?? 18 * scale;
    for (const [dx, dy] of [
      [0, 38 * scale],
      [0, -25 * scale],
      [w / 2 + 24 * scale, 5 * scale],
      [-w / 2 - 24 * scale, 5 * scale],
      [w / 2 + 24 * scale, 32 * scale],
      [-w / 2 - 24 * scale, 32 * scale],
      [w / 2 + 24 * scale, -25 * scale],
      [-w / 2 - 24 * scale, -25 * scale],
      ...(l.priority >= 100
        ? [
            [width / 2 - l.x, 24 * scale - l.y],
            [width / 2 - l.x, height - 10 * scale - l.y],
          ]
        : []),
    ]) {
      const p = { ...l, x: l.x + dx, y: l.y + dy, width: w, height: h, anchor: { x: l.x, y: l.y } };
      const box = { x: p.x - w / 2, y: p.y - h, width: w, height: h + 4 };
      if (
        p.x - w / 2 < 4 ||
        p.x + w / 2 > width - 4 ||
        p.y < 15 * scale ||
        p.y > height - 6 * scale
      )
        continue;
      if (occupied.some((b) => intersects(box, b))) continue;
      placed.push(p);
      occupied.push(box);
      break;
    }
  }
  return placed;
}
