import type { SimulationEngine } from './engine';
import type { Ship, Location } from './types';
import { SHIP_CLASSES } from './definitions/ships';
export function destroyShip(e: SimulationEngine, s: Ship, reason: string) {
  const w = e.state;
  if (w.losses.some((l) => l.shipId === s.id)) return;
  const operatorIds = w.assignments.filter((a) => a.shipId === s.id).map((a) => a.operatorId);
  w.losses.push({
    shipId: s.id,
    name: s.name,
    classId: s.classId,
    tick: w.tick,
    position: { x: s.x, y: s.y },
    reason,
    cargo: structuredClone(s.cargo),
    ammunition: { photon: s.photon, quantum: s.quantum },
    operatorIds,
    orderId: s.orderId,
  });
  for (const id of operatorIds) {
    const op = w.operators.find((o) => o.id === id);
    if (op) op.availability = 'vesselLost';
  }
  w.assignments = w.assignments.filter((a) => a.shipId !== s.id);
  for (const ammo of ['photon', 'quantum'] as const) {
    w.armory.reserved[ammo] -= s.rearm[ammo];
    s.rearm[ammo] = 0;
  }
  const order = w.orders.find((o) => o.id === s.orderId);
  s.orderId = null;
  s.path = [];
  s.targetId = null;
  s.behavior = 'hold';
  w.ships = w.ships.filter((x) => x.id !== s.id);
  if (
    order &&
    !order.settled &&
    (order.kind !== 'defense' ||
      !w.ships.some((x) => x.orderId === order.id && x.status === 'mission'))
  )
    e.settle(order, 'failed', '执行舰船永久损失');
  e.report(s.name + ' 已摧毁，舰籍转入 ARCHIVE', s.id, 'urgent');
  e.critical('shipDestroyed', s.id, s.name + ' 永久损失');
  e.pendingEvents.push({ type: 'shipDestroyed', shipId: s.id, operatorIds, tick: w.tick });
}
export function applyDamage(
  e: SimulationEngine,
  target: Ship | Location,
  amount: number,
  attacker?: Ship,
) {
  const w = e.state;
  if (target.hull <= 0 || amount <= 0) return;
  const previous = target.hull,
    absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  target.hull = Math.max(0, target.hull - (amount - absorbed));
  target.attackedAt = w.time;
  if ('classId' in target) {
    target.lastAttackerId = attacker?.id ?? null;
    if (target.factionId === 'starfleet') {
      if (
        attacker?.factionId === 'pirate' &&
        target.hull < SHIP_CLASSES[target.classId].hull * 0.5
      ) {
        const raider = w.enemies.find((x) => x.id === attacker.id);
        if (raider)
          for (const k of ['supplies', 'medical', 'materials'] as const) {
            const n = Math.min(target.cargo[k], Math.max(0, 20 - raider.loot));
            target.cargo[k] -= n;
            raider.cargo[k] += n;
            raider.loot += n;
          }
      }
      if (
        previous >= SHIP_CLASSES[target.classId].hull * 0.3 &&
        target.hull < SHIP_CLASSES[target.classId].hull * 0.3
      )
        e.critical('lowHull', target.id, target.name + ' 舰体低于30%');
      if (target.hull === 0) destroyShip(e, target, attacker ? '交战损失' : '调查环境损伤');
    } else {
      const i = w.intel.find((i) => i.id === target.id && i.live);
      if (i && i.classId) {
        i.hull = target.hull;
        i.shield = target.shield;
      }
      if (i && target.hull === 0) {
        i.resolved = true;
        i.resolution = 'destroyed';
        e.report('确认敌方接触已摧毁', i.id, 'high');
      }
    }
  } else {
    if (!target.distress) {
      target.distress = true;
      e.report(target.name + ' 遭袭，请求防御', target.id, 'urgent', 'request');
    }
    const raider = w.enemies.find((x) => x.id === attacker?.id && x.factionId === 'pirate');
    if (raider)
      for (const k of ['supplies', 'medical', 'materials'] as const) {
        const n = Math.min(
          2,
          Math.max(0, target.stock[k] - target.reserved[k]),
          Math.max(0, 20 - raider.loot),
        );
        target.stock[k] -= n;
        raider.cargo[k] += n;
        raider.loot += n;
      }
    if (target.hull === 0) {
      e.report(target.name + ' 已摧毁', target.id, 'urgent');
      for (const o of w.orders.filter(
        (o) =>
          !o.settled &&
          (o.sourceId === target.id || ('id' in o.objective && o.objective.id === target.id)),
      ))
        e.settle(o, 'failed', '行动设施已摧毁');
      if (target.kind === 'base') {
        w.status = 'commandLost';
        w.paused = true;
        for (const o of w.orders.filter((o) => !o.settled)) e.settle(o, 'failed', 'COMMAND LOST');
        e.critical('commandLost', target.id, 'COMMAND LOST — DAWN STARBASE DESTROYED');
        e.pendingEvents.push({ type: 'commandLost', tick: w.tick });
      }
    }
  }
}
