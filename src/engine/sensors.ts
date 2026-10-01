import type { Enemy, IntelRecord, WorldState } from './types';
import { SHIP_CLASSES } from './definitions/ships';
import { RULES } from './definitions/rules';
import { dist } from './navigation';
export const visibleIntel = (w: WorldState) =>
  w.intel.filter(
    (i) => i.level !== 'UNKNOWN' && !i.resolved && w.time - i.lastSeen <= RULES.intelTTL,
  );
export function observe(
  w: WorldState,
  e: Enemy,
  amount: number,
): { record: IntelRecord; fresh: boolean; hostility: boolean } {
  let i = w.intel.find((i) => i.id === e.id);
  const fresh = !i;
  if (!i) {
    i = {
      id: e.id,
      x: e.x,
      y: e.y,
      level: 'CONTACT',
      strength: 0,
      lastSeen: w.time,
      live: true,
      hostile: false,
      resolved: false,
    };
    w.intel.push(i);
  }
  const wasHostile = i.hostile;
  i.x = e.x;
  i.y = e.y;
  i.lastSeen = w.time;
  i.live = true;
  i.strength = Math.min(12, i.strength + amount);
  i.level =
    i.strength >= 10
      ? 'TRACKED'
      : i.strength >= 6
        ? 'IDENTIFIED'
        : i.strength >= 3
          ? 'CLASSIFIED'
          : 'CONTACT';
  if (i.strength >= 3) i.factionId = e.factionId;
  if (i.strength >= 6) {
    i.name = e.name;
    i.classId = e.classId;
    i.hull = e.hull;
    i.shield = e.shield;
  }
  if (i.strength >= 3 && (e.factionId === 'pirate' || e.attackedAt === w.time)) i.hostile = true;
  return { record: i, fresh, hostility: !wasHostile && i.hostile };
}
export function updateSensors(
  w: WorldState,
  random: () => number,
  onDetection: (i: IntelRecord, fresh: boolean, hostility: boolean) => void,
) {
  const base = w.locations.find((l) => l.id === 'base')!;
  for (const i of w.intel) i.live = false;
  for (const e of w.enemies) {
    if (e.hull <= 0) continue;
    let strength = 0;
    const sources = [
      { x: base.x, y: base.y, range: base.hull > 0 ? RULES.baseSensors : 0, active: false },
      ...w.ships
        .filter((s) => s.hull > 0)
        .map((s) => ({
          x: s.x,
          y: s.y,
          range: SHIP_CLASSES[s.classId].sensors,
          active: s.scanUntil > w.time,
        })),
    ];
    for (const source of sources) {
      const d = dist(source, e),
        range = source.range * (source.active ? 1.2 : 1);
      if (d > range) continue;
      const probability = e.cloak === 'on' ? (source.active ? 0.48 : 0.16) : 1;
      if (probability === 1 || random() < probability)
        strength = Math.max(strength, source.active ? 2 : 1);
    }
    if (strength) {
      const result = observe(w, e, strength);
      onDetection(result.record, result.fresh, result.hostility);
    }
  }
}
