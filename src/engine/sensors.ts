import type { SimulationEngine } from './engine';
import type { Enemy, WorldState } from './types';
import { capabilities } from './capabilities';
import { dist } from './navigation';
import { RULES } from './definitions/rules';
export const visibleIntel = (w: WorldState) =>
  w.intel.filter((i) => !i.resolved && w.time - i.lastSeen <= RULES.intelTTL);
export function observe(w: WorldState, s: Enemy, strength: number) {
  let i = w.intel.find((i) => i.id === s.id);
  const fresh = !i;
  if (!i) {
    i = {
      id: s.id,
      x: s.x,
      y: s.y,
      level: 'CONTACT',
      strength: 0,
      lastSeen: w.time,
      live: true,
      hostile: false,
      velocity: { x: 0, y: 0 },
      resolved: false,
    };
    w.intel.push(i);
  }
  const elapsed = w.time - i.lastSeen;
  if (elapsed > 0) i.velocity = { x: (s.x - i.x) / elapsed, y: (s.y - i.y) / elapsed };
  i.x = s.x;
  i.y = s.y;
  i.lastSeen = w.time;
  i.live = true;
  i.strength = Math.min(12, i.strength + strength);
  i.level =
    i.strength >= 10
      ? 'TRACKED'
      : i.strength >= 6
        ? 'IDENTIFIED'
        : i.strength >= 3
          ? 'CLASSIFIED'
          : 'CONTACT';
  if (i.strength >= 3) i.factionId = s.factionId;
  if (i.strength >= 6) {
    i.name = s.name;
    i.classId = s.classId;
    i.hull = s.hull;
    i.shield = s.shield;
  }
  if (w.time - s.lastHostileAt < 30) {
    i.hostile = true;
    i.lastAttackAt = s.lastHostileAt;
    i.lastAttackTargetId = s.lastHostileTargetId ?? undefined;
  }
  return { record: i, fresh };
}
export function updateSensors(e: SimulationEngine) {
  const w = e.state;
  for (const i of w.intel) i.live = false;
  const sources = [
    ...[...w.ships, ...w.civilians].map((s) => ({
      ...s,
      range: capabilities(s).sensors,
      active: s.scanUntil > w.time,
    })),
    ...w.locations
      .filter((l) => l.owner === 'starfleet' && l.hull > 0)
      .map((l) => ({
        ...l,
        range:
          l.kind === 'base'
            ? RULES.baseSensors
            : l.kind === 'outpost'
              ? w.upgrades.sensors
                ? 340
                : 160
              : 80,
        // Supply decay affects sensor reach, not the information authority boundary.
        active: !!w.upgrades.sensors,
      })),
  ];
  for (const enemy of w.enemies) {
    const source = sources.find(
      (s) =>
        dist(s, enemy) <
        s.range *
          (s.active ? 1.15 : 1) *
          ('supplyState' in s && s.supplyState === 'depleted' ? 0.25 : 1),
    );
    if (!source || (enemy.cloak === 'on' && e.random() > (source.active ? 0.6 : 0.2))) continue;
    const result = observe(w, enemy, source.active ? 2 : 1);
    if (result.fresh) e.report('发现接触：' + result.record.id, result.record.id, 'high', 'threat');
  }
  for (const l of w.locations.filter((l) => l.owner !== 'starfleet' && !l.discovered && l.hull > 0))
    if (w.ships.some((s) => dist(s, l) < Math.min(capabilities(s).sensors, 150))) {
      l.discovered = true;
      e.record('discovery', '发现 ' + l.name, l.id);
    }
  for (const wreck of w.wrecks)
    if (!wreck.discovered && sources.some((s) => dist(s, wreck) < s.range)) {
      wreck.discovered = true;
      e.record('discovery', '发现 ' + wreck.name, wreck.id);
    }
}
