import type { SimulationEngine } from './engine';
import type { Ship } from './types';
import { SHIP_CLASSES } from './definitions/ships';
import { RULES } from './definitions/rules';
import { RESOURCE_DEFINITIONS } from './definitions/resources';
export function advanceService(e: SimulationEngine, s: Ship, dt: number): boolean {
  if (s.status !== 'repairing' && s.status !== 'rearming') return false;
  if (s.status === 'repairing')
    s.hull = Math.min(
      SHIP_CLASSES[s.classId].hull,
      s.hull + Math.min(s.service, dt) * RULES.repairRate,
    );
  s.service -= dt;
  if (s.service > 1e-8) return true;
  if (s.status === 'repairing') {
    s.status = 'docked';
  } else {
    const ammo = s.rearm.photon > 0 ? 'photon' : s.rearm.quantum > 0 ? 'quantum' : null;
    if (ammo) {
      s[ammo]++;
      s.rearm[ammo]--;
      e.state.armory.stock[ammo]--;
      e.state.armory.reserved[ammo]--;
    }
    if (s.rearm.photon + s.rearm.quantum > 0) {
      s.service += RULES.torpedoLoadMinutes;
      return true;
    }
    s.status = 'docked';
  }
  s.service = 0;
  e.report(s.name + ' 基地保障完成', s.id);
  return true;
}
export function advanceLogistics(e: SimulationEngine, dt: number) {
  const w = e.state,
    base = e.base;
  for (const l of w.locations)
    if (l.hull > 0 && w.time - l.attackedAt > 6)
      l.shield = Math.min(
        l.maxShield,
        l.shield + (l.kind === 'base' ? RULES.baseShieldRegen : 0) * dt,
      );
  if (w.tick % (RULES.resupplyMinutes * 10) !== 0 || base.hull <= 0) return;
  const manifest: string[] = [];
  for (const k of ['supplies', 'medical', 'materials'] as const) {
    const d = RESOURCE_DEFINITIONS[k];
    const n = Math.max(0, Math.min(d.resupplyAmount, d.resupplyCap - base.stock[k]));
    base.stock[k] += n;
    manifest.push(d.label + ' +' + n);
  }
  for (const [k, amount, cap] of [
    ['photon', 24, 240],
    ['quantum', 6, 72],
  ] as const) {
    const n = Math.max(0, Math.min(amount, cap - w.armory.stock[k]));
    w.armory.stock[k] += n;
    manifest.push(k + ' +' + n);
  }
  e.report('Starfleet 外部补给清单入库：' + manifest.join('，'), 'base');
  for (const l of w.locations.filter(
    (l) => l.kind === 'colony' && l.regionId === 'federation' && l.hull > 0,
  )) {
    l.stock.supplies = Math.max(l.reserved.supplies, l.stock.supplies - 15);
    if (l.stock.supplies < 20 && !l.distress) {
      l.distress = true;
      e.report(l.name + ' 请求补给', l.id, 'high', 'request');
    }
  }
}
