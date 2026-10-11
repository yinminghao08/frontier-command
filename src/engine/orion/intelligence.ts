import type { Enemy, OrionReport, Point } from '../types';
import type { SimulationEngine } from '../engine';
import { capabilities, cargoUsed } from '../capabilities';
import { canDetectShip } from '../tracking';
import { dist } from '../navigation';
import { ORION_RULES as R } from '../definitions/orion';
import { facilityCapabilities } from '../definitions/facilities';
import { SHIP_CLASSES, WEAPONS } from '../definitions/ships';

export function combatStrength(
  s: Pick<Enemy, 'classId' | 'hull' | 'shield' | 'photon' | 'quantum' | 'weapons'>,
) {
  const d = SHIP_CLASSES[s.classId];
  const dps =
    (d.weapons.reduce((n, key) => {
      const weapon = WEAPONS[key];
      return (
        n +
        (weapon.ammo && s[weapon.ammo] <= 0
          ? 0
          : (weapon.damage * weapon.accuracy) / weapon.cooldown)
      );
    }, 0) *
      s.weapons) /
    100;
  return (s.hull + s.shield) * (0.5 + dps / 12);
}
const merge = (old: OrionReport[], incoming: readonly OrionReport[], time: number) => {
  const result = new Map(old.filter((r) => time - r.seenAt <= R.reportTTL).map((r) => [r.id, r]));
  for (const r of incoming) {
    const previous = result.get(r.id);
    const danger = (r: OrionReport) => r.defense + r.escorts.reduce((n, s) => n + s.strength, 0);
    if (
      !previous ||
      previous.seenAt < r.seenAt ||
      (previous.seenAt === r.seenAt &&
        (previous.observerId === r.observerId || danger(r) > danger(previous)))
    )
      result.set(r.id, structuredClone(r));
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
};
export function localReports(e: SimulationEngine, s: Enemy) {
  return (e.state.orion.intelligence[s.id] ?? []).filter(
    (r) => e.state.time - r.seenAt <= R.reportTTL,
  );
}
export function observeOrion(e: SimulationEngine) {
  const w = e.state,
    intelligence = w.orion.intelligence;
  const ships = w.enemies
    .filter((s) => s.factionId === 'orion' && s.hull > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const s of ships) {
    const visible = [...w.ships, ...w.civilians].filter(
      (t) => t.hull > 0 && canDetectShip(s, t, w.time),
    );
    const visibleFacilities = w.locations.filter(
      (l) => l.owner === 'starfleet' && l.hull > 0 && dist(s, l) <= capabilities(s).sensors,
    );
    const observations: OrionReport[] = visible.map((t) => {
      const old = (intelligence[s.id] ?? []).find((r) => r.id === t.id);
      const elapsed = old ? w.time - old.seenAt : 0;
      const escorts: OrionReport['escorts'] = visible
        .filter((v) => v.id !== t.id && dist(v, t) <= R.escortRange)
        .map((v) => ({ id: v.id, strength: combatStrength(v), x: v.x, y: v.y }));
      for (const l of visibleFacilities)
        if (dist(l, t) < facilityCapabilities(l).range)
          escorts.push({
            id: l.id,
            strength: (l.hull + l.shield) * (0.5 + facilityCapabilities(l).damage / 36),
            x: l.x,
            y: l.y,
            defenseRange: facilityCapabilities(l).range,
          });
      const estimate = Math.floor(cargoUsed(t) / 10) * 10;
      return {
        id: t.id,
        observerId: s.id,
        seenAt: w.time,
        kind: 'ship',
        x: t.x,
        y: t.y,
        velocity:
          elapsed > 0 && elapsed <= R.tacticalTTL
            ? { x: (t.x - old!.x) / elapsed, y: (t.y - old!.y) / elapsed }
            : { x: 0, y: 0 },
        cargoEstimate: estimate,
        value:
          Math.floor(
            Object.entries(t.cargo).reduce(
              (n, [k, amount]) => n + amount * R.marketPrices[k as keyof typeof R.marketPrices],
              0,
            ) / 50,
          ) * 50,
        defense: combatStrength(t),
        classId: t.classId,
        escorts,
      };
    });
    for (const l of w.locations.filter(
      (l) => l.owner === 'starfleet' && l.hull > 0 && dist(s, l) <= capabilities(s).sensors,
    )) {
      const d = facilityCapabilities(l);
      const estimate = Math.floor(Object.values(l.stock).reduce((a, b) => a + b, 0) / 20) * 20;
      observations.push({
        id: l.id,
        observerId: s.id,
        seenAt: w.time,
        kind: 'facility',
        x: l.x,
        y: l.y,
        velocity: { x: 0, y: 0 },
        cargoEstimate: estimate,
        value: estimate * 5,
        defense: (l.hull + l.shield) * (0.5 + d.damage / 36),
        defenseRange: d.range,
        classId: null,
        escorts: visible
          .filter((v) => dist(v, l) <= R.escortRange)
          .map((v) => ({ id: v.id, strength: combatStrength(v), x: v.x, y: v.y })),
      });
    }
    intelligence[s.id] = merge(intelligence[s.id] ?? [], observations, w.time);
    s.localReports = intelligence[s.id].map(
      ({ id, observerId, seenAt, value, defense, kind, x, y }) => ({
        id,
        observerId,
        seenAt,
        value,
        defense,
        kind,
        x,
        y,
      }),
    );
    for (const r of observations) {
      const robbed = w.orion.robbedTargets[r.id];
      if (robbed && r.cargoEstimate > robbed.cargoEstimate + 10) delete w.orion.robbedTargets[r.id];
      else if (robbed && r.seenAt >= robbed.seenAt)
        robbed.cargoEstimate = Math.min(robbed.cargoEstimate, r.cargoEstimate);
    }
  }
  // Each hop reads the same observation batch. A distant report never teleports across a network.
  const nodes: (Point & { id: string })[] = [
    ...ships,
    ...w.locations.filter((l) => l.owner === 'orion' && l.hull > 0),
  ];
  const before = structuredClone(intelligence);
  for (const node of nodes) {
    const nearby = nodes.filter((n) => n.id !== node.id && dist(n, node) <= R.communicationRange);
    intelligence[node.id] = merge(
      before[node.id] ?? [],
      nearby.flatMap((n) => before[n.id] ?? []),
      w.time,
    );
  }
  const homes = w.locations.filter((l) => l.owner === 'orion' && l.hull > 0);
  w.factions.orion.reports = merge(
    [],
    homes.flatMap((l) => intelligence[l.id] ?? []),
    w.time,
  ).map(({ id, observerId, seenAt, value, defense, kind, x, y }) => ({
    id,
    observerId,
    seenAt,
    value,
    defense,
    kind,
    x,
    y,
  }));
}
/** Constant-velocity prediction from received observations, bounded by report age and pursuit. */
export function predictedPosition(r: OrionReport, time: number, lead = 0): Point {
  const minutes = Math.max(0, Math.min(12, time - r.seenAt + lead));
  const speed = Math.hypot(r.velocity.x, r.velocity.y),
    scale = speed > 15 ? 15 / speed : 1;
  return { x: r.x + r.velocity.x * scale * minutes, y: r.y + r.velocity.y * scale * minutes };
}
