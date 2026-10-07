import { capabilities } from './capabilities';
import {
  dist,
  knownRouteHazards,
  planRoute,
  routeEstimate,
  routeSpeedMultiplier,
  segmentDistance,
  type Chart,
} from './navigation';
import type {
  JourneyLeg,
  JourneyPlan,
  KnownWormhole,
  Point,
  ReadonlyDeep,
  RouteKind,
  Ship,
} from './types';

export type JourneyChart = Chart & { wormholes: readonly ReadonlyDeep<KnownWormhole>[] };
/** This planner uses only charted hazards and passages whose exits were actually confirmed. */
export function journeyOptions(
  w: JourneyChart,
  ship: ReadonlyDeep<Ship>,
  end: Point,
  riskTolerance = 40,
): JourneyPlan[] {
  const holes = w.wormholes
    .filter((h) => h.discovered && h.surveyed && h.exit)
    .sort(
      (a, b) =>
        dist(ship, a) + dist(a.exit!, end) - (dist(ship, b) + dist(b.exit!, end)) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 24);
  const nodes: Point[] = [ship, end, ...holes.flatMap((h) => [h, h.exit!])];
  const hazards = knownRouteHazards(w);
  const weight = 3 * (1 - Math.max(0, Math.min(100, riskTolerance)) / 100);
  return (['safe', 'direct', 'risky'] as const).map((route) => {
    const best = nodes.map(() => Infinity),
      visited = new Set<number>();
    const previous: ({
      from: number;
      leg: JourneyLeg;
      eta: number;
      risk: number;
      distance: number;
    } | null)[] = nodes.map(() => null);
    best[0] = 0;
    for (let step = 0; step < nodes.length; step++) {
      let at = -1;
      for (let i = 0; i < nodes.length; i++)
        if (!visited.has(i) && (at < 0 || best[i] < best[at] - 1e-8)) at = i;
      if (at < 0 || !Number.isFinite(best[at]) || at === 1) break;
      visited.add(at);
      for (let next = 1; next < nodes.length; next++) {
        if (visited.has(next) || next === at) continue;
        const hole = at >= 2 && at % 2 === 0 && next === at + 1 ? holes[(at - 2) / 2] : null;
        const path = hole ? [] : planRoute(w, nodes[at], nodes[next], route);
        let length = 0,
          position = nodes[at],
          exposure = 0;
        for (const point of path) {
          length += dist(position, point);
          exposure += hazards.filter((h) => segmentDistance(h, position, point) < 100).length * 22;
          position = point;
        }
        const eta = hole
          ? 2
          : length / (capabilities(ship).warp * routeSpeedMultiplier(w.upgrades, route));
        const risk = hole
          ? hole.stable
            ? 0
            : (1 - hole.stability) * 60
          : exposure +
            (route === 'risky' ? Math.min(100, ((eta * 0.75) / Math.max(1, ship.hull)) * 100) : 0);
        const score = best[at] + eta + risk * weight;
        if (score >= best[next] - 1e-8) continue;
        best[next] = score;
        previous[next] = {
          from: at,
          eta,
          risk,
          distance: length,
          leg: hole
            ? {
                type: 'wormhole',
                wormholeId: hole.id,
                entrance: { x: hole.x, y: hole.y },
                destination: { ...hole.exit! },
              }
            : { type: 'warp', destination: { x: nodes[next].x, y: nodes[next].y }, route, path },
        };
      }
    }
    const edges: NonNullable<(typeof previous)[number]>[] = [];
    for (let at = 1; at !== 0 && previous[at]; at = previous[at]!.from)
      edges.unshift(previous[at]!);
    const warpUnknown = edges.reduce(
      (n, edge) =>
        edge.leg.type === 'warp'
          ? n +
            routeEstimate(
              w,
              { ...ship, x: nodes[edge.from].x, y: nodes[edge.from].y },
              edge.leg.destination,
              route,
            ).unknownDistance
          : n,
      0,
    );
    return {
      destination: { x: end.x, y: end.y },
      legs: edges.map((e) => e.leg),
      eta: edges.reduce((n, e) => n + e.eta, 0),
      risk: Math.min(100, edges.reduce((n, e) => n + e.risk, 0) + warpUnknown / 300),
      score: best[1] + (warpUnknown / 300) * weight,
      distance: edges.reduce((n, e) => n + e.distance, 0),
      unknownDistance: warpUnknown,
    };
  });
}
export function planJourney(
  w: JourneyChart,
  ship: ReadonlyDeep<Ship>,
  end: Point,
  route?: RouteKind,
  riskTolerance = 40,
) {
  const options = journeyOptions(w, ship, end, riskTolerance);
  return route
    ? options[(['safe', 'direct', 'risky'] as const).indexOf(route)]
    : options.sort((a, b) => a.score - b.score || a.eta - b.eta)[0];
}
