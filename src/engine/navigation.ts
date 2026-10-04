import type { Point, RouteKind, Ship, Snapshot, ReadonlyDeep } from './types';
import { capabilities } from './capabilities';
import { RULES } from './definitions/rules';
import { SECTOR_SIZE } from './definitions/locations';
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function segmentDistance(p: Point, a: Point, b: Point) {
  const l = (b.x - a.x) ** 2 + (b.y - a.y) ** 2,
    t = l
      ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l))
      : 0;
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
export function move(s: Ship, p: Point, dt: number, factor = 1) {
  const d = dist(s, p),
    step = capabilities(s).warp * dt * factor;
  s.heading = Math.atan2(p.y - s.y, p.x - s.x);
  if (d <= step) {
    s.x = p.x;
    s.y = p.y;
    return true;
  }
  s.x += Math.cos(s.heading) * step;
  s.y += Math.sin(s.heading) * step;
  return false;
}
type Chart = Pick<Snapshot, 'locations' | 'bodies' | 'upgrades' | 'sectors'> & {
  intel?: Snapshot['contacts'];
  contacts?: Snapshot['contacts'];
  time: number;
};
/** Clip each segment against the union of charted sectors; no hidden geography is consulted. */
function unchartedDistance(w: Chart, start: Point, path: Point[]) {
  let at = start,
    unknown = 0;
  for (const end of path) {
    const intervals: [number, number][] = [];
    for (const sector of w.sectors.filter((s) => s.discovered)) {
      let enter = 0,
        exit = 1;
      for (const axis of ['x', 'y'] as const) {
        const center = (axis === 'x' ? sector.q : sector.r) * SECTOR_SIZE;
        const low = center - SECTOR_SIZE / 2,
          high = center + SECTOR_SIZE / 2;
        const delta = end[axis] - at[axis];
        if (delta === 0) {
          if (at[axis] < low || at[axis] > high) exit = -1;
        } else {
          const a = (low - at[axis]) / delta,
            b = (high - at[axis]) / delta;
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
      }
      if (exit > enter) intervals.push([enter, exit]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0,
      edge = 0;
    for (const [enter, exit] of intervals) {
      covered += Math.max(0, exit - Math.max(edge, enter));
      edge = Math.max(edge, exit);
    }
    unknown += dist(at, end) * Math.max(0, 1 - covered);
    at = end;
  }
  return unknown;
}
export function planRoute(w: Chart, start: Point, end: Point, route: RouteKind): Point[] {
  if (route === 'direct') return [{ ...end }];
  if (route === 'risky')
    return [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 65 }, { ...end }];
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const facilities = w.locations.filter(
    (l) => l.owner === 'starfleet' && l.hull > 0 && dist(l, start) > 20 && dist(l, end) > 20,
  );
  const nearest = facilities.sort(
    (a, b) => dist(start, a) + dist(a, end) - (dist(start, b) + dist(b, end)),
  )[0];
  const hazards = [
    ...w.bodies.filter((b) => b.discovered && b.kind === 'anomaly'),
    ...(w.intel ?? w.contacts ?? []).filter(
      (i) => i.hostile && !i.resolved && w.time - i.lastSeen <= RULES.intelTTL,
    ),
  ];
  const crossing = hazards.find((h) => segmentDistance(h, start, end) < 85);
  if (crossing) return [{ x: mid.x - 100, y: mid.y + 140 }, { ...end }];
  if (dist(start, end) < 80) return [{ ...end }];
  if (nearest && dist(start, nearest) + dist(nearest, end) <= dist(start, end) * 1.35 + 40)
    return [{ x: nearest.x, y: nearest.y }, { ...end }];
  return [{ x: mid.x, y: mid.y + 100 }, { ...end }];
}
export function routeEstimate(w: Chart, s: ReadonlyDeep<Ship>, end: Point, route: RouteKind) {
  const path = planRoute(w, s, end, route);
  let at: Point = s,
    length = 0;
  for (const p of path) {
    length += dist(at, p);
    at = p;
  }
  const factor = route === 'risky' ? 1.5 : route === 'safe' && w.upgrades.logistics ? 1.25 : 1;
  const contacts = (w.intel ?? w.contacts ?? []).filter(
    (i) => i.live && i.hostile && segmentDistance(i, s, end) < 200,
  ).length;
  return {
    path,
    distance: length,
    unknownDistance: unchartedDistance(w, s, path),
    eta: Math.ceil(length / (capabilities(s).warp * factor) + 4),
    risk:
      route === 'safe'
        ? 'LOW / defensive detour'
        : route === 'risky'
          ? 'HIGH / turbulent, exposed corridor'
          : contacts
            ? 'ELEVATED / observed threat'
            : 'UNVERIFIED / direct space',
  };
}
