import type { Point } from '../../engine/types';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../engine/definitions/locations';
export interface Camera {
  x: number;
  y: number;
  k: number;
  width: number;
  height: number;
}
export const fitCamera = (width: number, height: number): Camera => ({
  x: 0,
  y: 0,
  k: 1,
  width: Math.max(1, width),
  height: Math.max(1, height),
});
export function clampCamera(c: Camera): Camera {
  const k = Math.max(1, Math.min(8, c.k));
  return {
    ...c,
    k,
    x: Math.max(c.width * (1 - k), Math.min(0, c.x)),
    y: Math.max(c.height * (1 - k), Math.min(0, c.y)),
  };
}
export const project = (p: Point, c: Camera): Point => ({
  x: c.x + ((p.x * c.width) / WORLD_WIDTH) * c.k,
  y: c.y + ((p.y * c.height) / WORLD_HEIGHT) * c.k,
});
export const unproject = (p: Point, c: Camera): Point => ({
  x: (((p.x - c.x) / c.k) * WORLD_WIDTH) / c.width,
  y: (((p.y - c.y) / c.k) * WORLD_HEIGHT) / c.height,
});
export function zoomCamera(c: Camera, k: number, p: Point): Camera {
  const next = Math.max(1, Math.min(8, k)),
    ratio = next / c.k;
  return clampCamera({ ...c, k: next, x: p.x - (p.x - c.x) * ratio, y: p.y - (p.y - c.y) * ratio });
}
export function resizeCamera(c: Camera, width: number, height: number): Camera {
  if (c.k === 1) return fitCamera(width, height);
  const center = unproject({ x: c.width / 2, y: c.height / 2 }, c),
    next = { ...c, width: Math.max(1, width), height: Math.max(1, height) };
  return clampCamera({
    ...next,
    x: width / 2 - ((center.x * width) / WORLD_WIDTH) * c.k,
    y: height / 2 - ((center.y * height) / WORLD_HEIGHT) * c.k,
  });
}
export function focusCamera(c: Camera, p: Point): Camera {
  const k = Math.max(2.5, c.k);
  return clampCamera({
    ...c,
    k,
    x: c.width / 2 - ((p.x * c.width) / WORLD_WIDTH) * k,
    y: c.height / 2 - ((p.y * c.height) / WORLD_HEIGHT) * k,
  });
}
export interface MapLabel extends Point {
  id: string;
  text: string;
  priority: number;
  color: string;
}
export function placeLabels(labels: MapLabel[], width: number, height: number) {
  const placed: (MapLabel & { width: number })[] = [];
  for (const l of [...labels].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const w = Math.min(240, l.text.length * 6.8 + 8);
    for (const [dx, dy] of [
      [0, 22],
      [0, -23],
      [w / 2 + 18, 4],
      [-w / 2 - 18, 4],
    ]) {
      const p = { ...l, x: l.x + dx, y: l.y + dy, width: w };
      if (p.x - w / 2 < 4 || p.x + w / 2 > width - 4 || p.y < 15 || p.y > height - 6) continue;
      if (
        placed.some((x) => Math.abs(x.x - p.x) < (x.width + w) / 2 + 5 && Math.abs(x.y - p.y) < 20)
      )
        continue;
      placed.push(p);
      break;
    }
  }
  return placed;
}
