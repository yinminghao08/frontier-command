import type { Enemy, Location, OperationOrder, Ship, WorldState } from './types';
import { SHIP_CLASSES, WEAPONS, type WeaponDefinition } from './definitions/ships';
import { RULES } from './definitions/rules';
import { authorized, dist } from './navigation';
export function regenerate(s: Ship, time: number, dt: number) {
  const d = SHIP_CLASSES[s.classId];
  for (const id of Object.keys(s.cooldowns)) s.cooldowns[id] = Math.max(0, s.cooldowns[id] - dt);
  s.core = Math.min(d.core, s.core + d.coreRegen * dt);
  if (time - s.attackedAt > 6) s.shield = Math.min(d.shield, s.shield + d.shieldRegen * dt);
  if (s.cloak === 'on') {
    s.core = Math.max(0, s.core - RULES.cloakDrain * dt);
    if (s.core <= 5) {
      s.cloak = 'decloaking';
      s.cloakUntil = time + RULES.decloakMinutes;
    }
  }
  if (s.cloak === 'decloaking' && time >= s.cloakUntil) s.cloak = 'off';
}
export function permittedTarget(w: WorldState, s: Ship, o: OperationOrder, e: Enemy) {
  const intel = w.intel.find((i) => i.id === e.id);
  if (
    !intel?.live ||
    intel.resolved ||
    !['IDENTIFIED', 'TRACKED'].includes(intel.level) ||
    e.hull <= 0 ||
    !authorized(intel, o.border)
  )
    return false;
  if (o.roe === 'HOLD FIRE') return false;
  if (o.roe === 'WEAPONS FREE') return true;
  if (o.roe === 'ENGAGE HOSTILES') return intel.hostile;
  const protectedId = o.objective.type === 'point' ? null : o.objective.id;
  return (
    intel.hostile &&
    ((s.lastAttackerId === e.id && w.time - s.attackedAt < 12) ||
      (intel.lastAttackTargetId === protectedId &&
        intel.lastAttackAt !== undefined &&
        w.time - intel.lastAttackAt < 12))
  );
}
export function shouldRetreat(s: Ship, o: OperationOrder) {
  const d = SHIP_CLASSES[s.classId],
    r = o.retreat;
  return (
    (s.hull / d.hull) * 100 < r.hull ||
    (r.shield > 0 && (s.shield / d.shield) * 100 < r.shield) ||
    (r.core > 0 && (s.core / d.core) * 100 < r.core) ||
    (r.emptyAmmo && d.photon + d.quantum > 0 && s.photon + s.quantum === 0)
  );
}
export interface CombatHooks {
  random(): number;
  hit(target: Ship | Location, amount: number, attacker: Ship): void;
  fired(attacker: Ship, target: Ship | Location, weapon: WeaponDefinition, hit: boolean): void;
}
export function attack(w: WorldState, s: Ship, target: Ship | Location, hooks: CombatHooks) {
  if (s.hull <= 0 || target.hull <= 0) return;
  if (s.cloak === 'on') {
    s.cloak = 'decloaking';
    s.cloakUntil = w.time + RULES.decloakMinutes;
    return;
  }
  if (s.cloak === 'decloaking') return;
  for (const key of SHIP_CLASSES[s.classId].weapons) {
    const weapon: WeaponDefinition = WEAPONS[key];
    if (
      dist(s, target) > weapon.range ||
      (s.cooldowns[key] ?? 0) > 0 ||
      s.core < weapon.cost ||
      (weapon.ammo && s[weapon.ammo] <= 0)
    )
      continue;
    s.core -= weapon.cost;
    if (weapon.ammo) s[weapon.ammo]--;
    s.cooldowns[key] = weapon.cooldown;
    s.attackedAt = w.time;
    const hit = hooks.random() < weapon.accuracy;
    hooks.fired(s, target, weapon, hit);
    if (hit) hooks.hit(target, weapon.damage, s);
    if (target.hull <= 0) break;
  }
}
