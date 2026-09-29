import type { BorderPolicy, Objective, Point, Ship, WorldState } from './types';
import { SHIP_CLASSES } from './definitions/ships';
import { RULES } from './definitions/rules';
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const boundary = (b: BorderPolicy) =>
  b === 'federation' ? 1038 : b === 'neutral' ? 1278 : 1580;
export function objectivePosition(w: WorldState, o: Objective): Point | null {
  if (o.type === 'point') return { x: o.x, y: o.y };
  if (o.type === 'location') return w.locations.find((l) => l.id === o.id) ?? null;
  if (o.type === 'ship') return w.ships.find((s) => s.id === o.id) ?? null;
  const i = w.intel.find(
    (i) => i.id === o.id && w.time - i.lastSeen <= RULES.intelTTL && !i.resolved,
  );
  return i ? { x: i.x, y: i.y } : null;
}
export function move(s: Ship, p: Point, dt: number, border: BorderPolicy = 'romulan', factor = 1) {
  const target = {
    x: Math.max(20, Math.min(boundary(border), p.x)),
    y: Math.max(20, Math.min(780, p.y)),
  };
  const d = dist(s, target),
    step = SHIP_CLASSES[s.classId].warp * dt * factor;
  s.heading = Math.atan2(target.y - s.y, target.x - s.x);
  if (d <= step) {
    s.x = target.x;
    s.y = target.y;
    return true;
  }
  s.x += Math.cos(s.heading) * step;
  s.y += Math.sin(s.heading) * step;
  return false;
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length))
    : 0;
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
export function planRoute(
  w: WorldState,
  start: Point,
  end: Point,
  safe: boolean,
  border: BorderPolicy,
): Point[] {
  const goal = { x: Math.min(end.x, boundary(border)), y: end.y };
  if (!safe) return [goal];
  const hazards: (Point & { radius: number; weight: number })[] = [
    ...w.intel
      .filter((i) => !i.resolved && w.time - i.lastSeen <= RULES.intelTTL)
      .map((i) => ({ ...i, radius: 180, weight: i.hostile ? 7 : 3 })),
    ...w.locations
      .filter((l) => l.hazard > 0)
      .map((l) => ({ ...l, radius: l.surveyed ? 65 : 95, weight: 3 })),
  ];
  const candidates: Point[][] = [
    [goal],
    ...[-180, 180].map((offset) => [
      {
        x: (start.x + goal.x) / 2,
        y: Math.max(25, Math.min(775, (start.y + goal.y) / 2 + offset)),
      },
      goal,
    ]),
    [{ x: start.x, y: 430 }, { x: goal.x, y: 430 }, goal],
  ];
  const cost = (path: Point[]) => {
    let total = 0,
      a = start;
    for (const b of path) {
      total += dist(a, b);
      for (const h of hazards) total += Math.max(0, h.radius - segmentDistance(h, a, b)) * h.weight;
      a = b;
    }
    return total;
  };
  return candidates
    .map((path, index) => ({ path, index, cost: cost(path) }))
    .sort((a, b) => a.cost - b.cost || a.index - b.index)[0]
    .path.map((p) => ({ ...p }));
}
