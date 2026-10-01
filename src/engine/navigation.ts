import type { BorderPolicy, Objective, Point, Ship, WorldState } from './types';
import { SHIP_CLASSES } from './definitions/ships';
import { RULES } from './definitions/rules';
import {
  FEDERATION_EDGE,
  ROMULAN_EDGE,
  edgeAt,
  regionAt,
  TRANSPORT_LINKS,
} from './definitions/locations';
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const boundary = (b: BorderPolicy, y = 400) =>
  b === 'federation'
    ? edgeAt(FEDERATION_EDGE, y) - 1
    : b === 'neutral'
      ? edgeAt(ROMULAN_EDGE, y) - 1
      : 1580;
export function authorized(p: Point, b: BorderPolicy) {
  return (
    p.x >= 20 &&
    p.x <= 1580 &&
    p.y >= 20 &&
    p.y <= 780 &&
    (b === 'romulan' ||
      regionAt(p.x, p.y) === 'federation' ||
      (b === 'neutral' && regionAt(p.x, p.y) === 'neutral'))
  );
}
export function segmentAllowed(a: Point, b: Point, policy: BorderPolicy) {
  const ts = [
    0,
    1,
    ...[...FEDERATION_EDGE, ...ROMULAN_EDGE]
      .map((p) => (p.y - a.y) / (b.y - a.y))
      .filter((t) => t > 0 && t < 1),
  ];
  return ts.every((t) =>
    authorized({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, policy),
  );
}
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
    x: Math.max(20, Math.min(1580, p.x)),
    y: Math.max(20, Math.min(780, p.y)),
  };
  if (!segmentAllowed(s, target, border)) return false;
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
  if (!authorized(end, border)) return [];
  if (!safe && segmentAllowed(start, end, border)) return [{ ...end }];
  const hazards = [
    ...w.intel
      .filter((i) => !i.resolved && w.time - i.lastSeen <= RULES.intelTTL)
      .map((i) => ({ ...i, radius: 180, weight: i.hostile ? 7 : 3 })),
    ...w.locations
      .filter((l) => l.kind === 'anomaly')
      .map((l) => ({ ...l, radius: l.surveyed ? 65 : 95, weight: 3 })),
  ];
  const nodes: (Point & { id: string })[] = [
    { ...start, id: '@start' },
    { ...end, id: '@end' },
    ...w.locations.filter((l) => authorized(l, border)),
    ...FEDERATION_EDGE.filter((p) => p.y > 0 && p.y < 800).map((p, i) => ({
      x: p.x - 25,
      y: p.y,
      id: '@border' + i,
    })),
  ];
  const cost = (a: Point, b: Point) =>
    dist(a, b) +
    (safe
      ? hazards.reduce(
          (sum, h) => sum + Math.max(0, h.radius - segmentDistance(h, a, b)) * h.weight,
          0,
        )
      : 0);
  const distances = nodes.map(() => Infinity),
    previous = nodes.map(() => -1),
    visited = new Set<number>();
  distances[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let at = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (at < 0 || distances[i] < distances[at])) at = i;
    if (at < 0 || !Number.isFinite(distances[at]) || at === 1) break;
    visited.add(at);
    for (let j = 0; j < nodes.length; j++) {
      if (visited.has(j) || j === at || !segmentAllowed(nodes[at], nodes[j], border)) continue;
      const lane = TRANSPORT_LINKS.some(([a, b]) => {
        const from = w.locations.find((l) => l.id === a),
          to = w.locations.find((l) => l.id === b);
        return (
          from &&
          to &&
          segmentDistance(nodes[at], from, to) < 1 &&
          segmentDistance(nodes[j], from, to) < 1
        );
      });
      const next = distances[at] + cost(nodes[at], nodes[j]) * (lane ? 0.9 : 1);
      if (next < distances[j]) {
        distances[j] = next;
        previous[j] = at;
      }
    }
  }
  if (!Number.isFinite(distances[1])) return [];
  const result: Point[] = [];
  for (let at = 1; at !== 0; at = previous[at]) {
    if (at < 0) return [];
    result.unshift({ x: nodes[at].x, y: nodes[at].y });
  }
  return result;
}
