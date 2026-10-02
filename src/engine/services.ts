import type { SimulationEngine } from './engine';
import { BUILD_COSTS, FACILITIES } from './definitions/progression';
import { makeShip, makeLocation } from './data';
import { RULES } from './definitions/rules';
import type { CargoKind, UpgradeId } from './types';
import type { ShipClassId } from './definitions/ships';
import { dist } from './navigation';
import { available } from './command-system';
export function advanceEconomy(e: SimulationEngine, dt: number) {
  const w = e.state,
    base = e.base;
  // Each 240 game minutes the rear produces one minimum-cost hull's construction basket.
  w.rearProduction += dt;
  if (w.rearProduction >= 1 - 1e-8) {
    w.rearProduction = Math.max(0, w.rearProduction - 1);
    const c = BUILD_COSTS.peregrine;
    w.resources.credits += c.credits / RULES.rearCycleMinutes;
    base.stock.materials += c.materials / RULES.rearCycleMinutes;
    base.stock.supplies += c.supplies / RULES.rearCycleMinutes;
  }
  for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)) {
    l.core = Math.min(300, l.core + 5 * dt);
    l.cooldown = Math.max(0, l.cooldown - dt);
    if (w.time - l.attackedAt > 10)
      l.shield = Math.min(l.maxShield, l.shield + (l.kind === 'base' ? 12 : 3) * dt);
    l.production += dt;
    if (l.production >= 5 - 1e-8) {
      l.production = Math.max(0, l.production - 5);
      if (l.kind === 'colony' && available(w, l.id, 'supplies') >= 1) {
        l.stock.supplies--;
        w.resources.credits += 18;
      }
      if (l.kind === 'mine' && available(w, l.id, 'supplies') >= 0.15) {
        const site = w.bodies.find((b) => b.id === l.siteId);
        if (site && site.remaining > 0) {
          const amount = Math.min(site.remaining, 7 * site.richness);
          site.remaining -= amount;
          l.stock.materials += amount;
          l.stock.supplies -= 0.15;
        }
      }
      if (l.id !== 'base' && l.stock.supplies < 3 && !l.distress) {
        l.distress = true;
        e.report(l.name + ' Supplies 紧缺，前沿产出将停止', l.id, 'high', 'request');
      }
    }
    if (l.stock.supplies >= 8 && w.time - l.attackedAt > 30) l.distress = false;
    const def = FACILITIES[l.kind],
      target = w.enemies
        .filter((x) => x.hull > 0 && dist(x, l) < def.range)
        .filter(
          (x) =>
            w.intel.some((i) => i.id === x.id && i.live && i.hostile) ||
            (x.targetId === l.id && ['raid', 'probe'].includes(x.intent)),
        )
        .sort((a, b) => dist(a, l) - dist(b, l) || a.id.localeCompare(b.id))[0];
    if (target && l.cooldown === 0 && l.core >= 8) {
      l.core -= 8;
      l.cooldown = 3;
      e.beam(l, target, 'Facility Phaser');
      e.hit(target, def.damage * (w.upgrades.defense ? 1.2 : 1));
    }
  }
  for (const l of w.locations.filter((l) => l.owner !== 'starfleet' && l.hull > 0)) {
    l.core = Math.min(300, l.core + 5 * dt);
    l.cooldown = Math.max(0, l.cooldown - dt);
    if (w.time - l.attackedAt > 10) l.shield = Math.min(l.maxShield, l.shield + 3 * dt);
    const def = FACILITIES[l.kind],
      target = w.ships.find(
        (s) =>
          dist(s, l) < def.range &&
          ((s.current?.action.type === 'ATTACK' && s.current.action.targetId === l.id) ||
            w.time - l.attackedAt < 12),
      );
    if (target && l.cooldown === 0 && l.core >= 8) {
      l.core -= 8;
      l.cooldown = 3;
      e.beam(l, target, 'Facility Phaser');
      e.hit(target, def.damage);
    }
  }
  for (const p of w.projects.filter((p) => !p.complete)) {
    if (
      available(w, p.id, 'materials') + 1e-8 < p.cost.materials ||
      available(w, p.id, 'supplies') + 1e-8 < p.cost.supplies
    )
      continue;
    p.work += dt;
    if (p.work + 1e-8 >= p.duration) {
      p.stock.materials = Math.max(0, p.stock.materials - p.cost.materials);
      p.stock.supplies = Math.max(0, p.stock.supplies - p.cost.supplies);
      const l = makeLocation('facility-' + w.nextId++, p.name, p.kind, p, 'starfleet', p.siteId);
      l.stock = structuredClone(p.stock);
      l.stock.supplies += 0;
      w.locations.push(l);
      p.stock = { materials: 0, supplies: 0, photon: 0, quantum: 0, specialFinds: 0 };
      p.complete = true;
      if (l.x >= 780 && Math.abs(l.y) < 650) w.tension = Math.min(100, w.tension + 12);
      e.record('construction', p.name + ' 建成：独立库存、产出、传感器与自卫上线', l.id);
    }
  }
  for (const j of w.jobs.filter((j) => !j.complete)) {
    j.work += dt;
    if (j.work + 1e-8 < j.duration) continue;
    j.complete = true;
    if (j.kind === 'ship') {
      const s = makeShip('ship-' + w.nextId++, j.name, j.key as ShipClassId, 'starfleet', {
        x: base.x,
        y: base.y + 45,
      });
      // Shipyard builds empty magazines: loading transfers real Armory ammunition separately.
      s.photon = 0;
      s.quantum = 0;
      w.ships.push(s);
      const operatorId = 'ops-' + s.id;
      w.operators.push({
        id: operatorId,
        name: s.name + ' 值班指挥组',
        kind: 'rules',
        availability: 'available',
      });
      w.assignments.push({ operatorId, shipId: s.id, since: w.tick });
      e.record('growth', s.name + ' 新舰服役，独立舰籍 ' + s.id, s.id);
    } else if (j.kind === 'upgrade') {
      w.upgrades[j.key as UpgradeId] = 1;
      e.record('growth', j.name + ' 战略能力上线', 'base');
    } else {
      base.stock[j.key as CargoKind] += j.amount;
      e.record('industry', '制造 ' + j.amount + ' ' + j.key + ' 实物入库', 'base');
    }
  }
}
