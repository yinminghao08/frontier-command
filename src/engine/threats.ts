import type { Enemy, WorldState, ThreatReport, Point } from './types';
import { SHIP_CLASSES } from './definitions/ships';
import { RULES } from './definitions/rules';
import { dist } from './navigation';
import { FEDERATION_EDGE, edgeAt } from './definitions/locations';
/** Faction memory contains observations, never references to live target objects. */
export function decideThreat(w: WorldState, e: Enemy) {
  if (w.time < e.nextDecision) return;
  e.nextDecision = w.time + RULES.decisionInterval;
  const d = SHIP_CLASSES[e.classId];
  const visible = w.ships.filter((s) => s.hull > 0 && dist(e, s) <= d.sensors);
  const reports: ThreatReport[] = [
    ...visible.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      observerId: e.id,
      seenAt: w.time,
      confidence: 1,
      value: 60 + Object.values(s.cargo).reduce((a, b) => a + b, 0) * 4,
      defense:
        s.hull +
        s.shield +
        visible
          .filter((x) => x.id !== s.id && dist(x, s) < 180)
          .reduce((n, x) => n + x.hull + x.shield, 0) *
          0.7,
      kind: 'ship' as const,
    })),
    ...w.locations
      .filter(
        (l) =>
          l.hull > 0 &&
          l.regionId === 'federation' &&
          ['base', 'colony', 'mine', 'outpost'].includes(l.kind) &&
          dist(e, l) <= d.sensors,
      )
      .map((l) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        observerId: e.id,
        seenAt: w.time,
        confidence: 1,
        value:
          (l.kind === 'base' ? 500 : 100) + Object.values(l.stock).reduce((a, b) => a + b, 0) * 1.5,
        defense:
          l.hull +
          l.shield +
          visible.filter((s) => dist(s, l) < 220).reduce((n, s) => n + s.hull + s.shield, 0),
        kind: 'facility' as const,
      })),
  ];
  if (e.factionId === 'romulan') {
    w.romulanReports = w.romulanReports.filter(
      (r) =>
        w.time - r.seenAt <= RULES.reportTTL &&
        dist(e, r) > d.sensors &&
        !reports.some((n) => n.id === r.id),
    );
    w.romulanReports.push(...reports);
  }
  const observations = e.factionId === 'romulan' ? w.romulanReports : reports;
  const ownStrength = e.hull + e.shield;
  const scored = observations
    .filter((r) => w.time - r.seenAt <= RULES.reportTTL)
    .map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      seenAt: r.seenAt,
      score:
        r.value * (1 - (w.time - r.seenAt) / RULES.reportTTL) -
        r.defense * (e.factionId === 'pirate' ? 0.65 : 0.4) -
        Math.max(0, r.defense - ownStrength) * 0.5 -
        dist(e, r) * 0.1,
    }));
  if (e.factionId === 'pirate') {
    for (const l of w.locations.filter(
      (l) => l.regionId === 'federation' && ['colony', 'mine', 'outpost'].includes(l.kind),
    )) {
      if (
        !(dist(e, l) <= d.sensors && l.hull <= 0) &&
        !scored.some((t) => t.id === l.id) &&
        !e.knownTargets.some((t) => t.id === l.id)
      )
        scored.push({ id: l.id, x: l.x, y: l.y, seenAt: w.time, score: 100 - dist(e, l) * 0.08 });
    }
  }
  e.knownTargets = [
    ...scored,
    ...e.knownTargets.filter(
      (t) =>
        !scored.some((n) => n.id === t.id) &&
        dist(e, t) > d.sensors &&
        w.time - t.seenAt < RULES.threatMemoryMinutes,
    ),
  ].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const exhausted = d.photon + d.quantum > 0 && e.photon + e.quantum === 0;
  if (
    e.hull < d.hull * 0.35 ||
    e.loot >= 20 ||
    (e.core < 8 && e.classId !== 'scout') ||
    exhausted
  ) {
    e.intent = 'retreat';
    e.targetId = null;
    e.destination = e.home;
    return;
  }
  if (e.intent === 'retreat') return;
  const best = e.knownTargets[0];
  if (e.classId !== 'scout' && best && best.score > 0) {
    e.targetId = best.id;
    e.destination = { x: best.x, y: best.y };
    e.intent = e.factionId === 'pirate' ? 'raid' : 'probe';
    return;
  }
  e.targetId = null;
  if (e.factionId === 'pirate') {
    e.intent = 'retreat';
    e.destination = e.home;
    return;
  }
  e.intent = 'observe';
  // Revisit stale surveillance areas; approaches are derived from the chart border, not a waypoint script.
  const sites = w.locations.filter(
    (l) => l.regionId === 'federation' && ['base', 'outpost', 'mine', 'colony'].includes(l.kind),
  );
  const candidates = sites
    .map((l) => {
      const p: Point = {
        x: Math.min(edgeAt(FEDERATION_EDGE, l.y) + 45, l.x + d.sensors * 0.8),
        y: l.y,
      };
      const last = e.visited.find((v) => v.id === l.id)?.time ?? -1000;
      const risk = reports.filter((r) => dist(r, p) < 200).reduce((n, r) => n + r.defense, 0);
      return { id: l.id, p, score: Math.min(500, w.time - last) - dist(e, p) * 0.25 - risk * 0.3 };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = candidates[0];
  if (selected) {
    // Warbirds observe from their side until intelligence justifies a sortie.
    e.destination =
      e.classId === 'scout'
        ? selected.p
        : { x: Math.min(1550, selected.p.x + 260), y: selected.p.y };
    if (dist(e, e.destination) < 30) {
      e.visited = e.visited.filter((v) => v.id !== selected.id);
      e.visited.push({ id: selected.id, time: w.time });
    }
  }
}
