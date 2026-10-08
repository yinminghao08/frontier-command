import type { Enemy, Location, OrionOperation, Ship } from '../types';
import type { SimulationEngine } from '../engine';
import { capabilities, cargoUsed } from '../capabilities';
import { dist, move } from '../navigation';
import { canDetectShip, advanceEvasion } from '../tracking';
import { regenerate } from '../combat';
import { ORION_RULES as R } from '../definitions/orion';
import { localReports, combatStrength, predictedPosition, observeOrion } from './intelligence';
import {
  advanceOrionEconomy,
  advanceOrionLogistics,
  advanceProvisioning,
  serviceOrion,
  retreatBase,
  ledger,
} from './economy';
import { openIncident, transferCargo, goodsCount, resolveIncident } from './piracy';
import { emptyStock } from '../data';
import { facilityCapabilities } from '../definitions/facilities';
const unitStrength = (s: Ship | Location) =>
  'classId' in s
    ? combatStrength(s)
    : (s.hull + s.shield) * (0.5 + facilityCapabilities(s).damage / 36);

const fleet = (e: SimulationEngine) =>
  e.state.enemies
    .filter((s) => s.factionId === 'orion' && s.hull > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
const assigned = (e: SimulationEngine, id: string) =>
  e.state.orion.operations.some(
    (op) => op.status === 'active' && op.members.some((m) => m.shipId === id),
  );
const available = (e: SimulationEngine, s: Enemy) =>
  e.state.time >= s.nextDecision &&
  !assigned(e, s.id) &&
  s.intent !== 'retreat' &&
  s.intent !== 'docked' &&
  !s.counterTracking.evading &&
  (s.loot === 0 || (!operatingHomeExists(e) && cargoUsed(s) < capabilities(s).cargo)) &&
  !e.state.orion.jobs.some((j) => j.status === 'active' && j.builderId === s.id) &&
  !e.state.orion.logistics.some((t) => t.shipId === s.id) &&
  !e.state.orion.provisioning.some((p) => p.shipId === s.id);
const changePhase = (e: SimulationEngine, op: OrionOperation, phase: OrionOperation['phase']) => {
  op.phase = phase;
  op.phaseAt = e.state.time;
  op.work = 0;
};
export function withdrawOperation(e: SimulationEngine, op: OrionOperation, reason: string) {
  if (op.phase === 'withdraw' || op.phase === 'resupply') return;
  op.reason = reason;
  changePhase(e, op, 'withdraw');
  const incident = e.state.piracyIncidents.find((i) => i.id === op.incidentId);
  if (incident)
    resolveIncident(
      e,
      incident,
      goodsCount(incident.lost) > 0
        ? 'Orion 已停止抢货；舰载传感器继续监视威胁'
        : '近距威胁解除，未发生货物转移',
    );
  // Keep the first-contact load: later sensor reports already include losses.
  if (op.taken > 0)
    e.state.orion.robbedTargets[op.targetId] = {
      cargoEstimate: Math.max(0, op.initialCargo - op.taken),
      seenAt: e.state.time,
      departed: false,
    };
  for (const member of op.members) {
    const s = fleet(e).find((s) => s.id === member.shipId);
    if (!s) continue;
    s.intent = 'retreat';
    s.targetId = null;
    const home = retreatBase(e, s);
    s.destination = home ? { x: home.x, y: home.y } : { x: s.x + 200, y: s.y - 180 };
  }
  ledger(e, 'withdraw', op.id);
}
export function planOrion(e: SimulationEngine) {
  const w = e.state;
  if (w.time + 1e-8 < w.orion.nextPlan) return;
  w.orion.nextPlan = w.time + R.planMinutes;
  // A newly observed vulnerable freighter can supersede a facility approach before shots are fired.
  for (const op of w.orion.operations.filter(
    (op) =>
      op.status === 'active' &&
      op.report.kind === 'facility' &&
      ['assemble', 'deploy', 'ambush'].includes(op.phase),
  )) {
    const members = fleet(e).filter((s) => op.members.some((m) => m.shipId === s.id));
    const power = members.reduce((n, s) => n + combatStrength(s), 0);
    const opportunity = members
      .flatMap((s) => localReports(e, s))
      .filter(
        (r) =>
          r.kind === 'ship' &&
          r.cargoEstimate >= 20 &&
          w.time - r.seenAt < R.tacticalTTL &&
          r.defense < op.report.defense &&
          r.escorts.reduce((n, x) => n + x.strength, 0) < power * 0.65 &&
          !w.orion.robbedTargets[r.id] &&
          !w.orion.operations.some(
            (other) => other !== op && other.status === 'active' && other.targetId === r.id,
          ),
      )
      .sort((a, b) => b.value - a.value || b.seenAt - a.seenAt || a.id.localeCompare(b.id))[0];
    if (opportunity) {
      op.targetId = opportunity.id;
      op.report = structuredClone(opportunity);
      op.motion = { x: opportunity.x, y: opportunity.y, observedAt: opportunity.seenAt };
      op.intercept = predictedPosition(opportunity, w.time, 5);
      changePhase(e, op, 'deploy');
      for (const s of members) s.targetId = op.targetId;
    }
  }
  for (const leader of fleet(e)
    .filter((s) => available(e, s) && !w.orion.provisioning.some((p) => p.shipId === s.id))
    .sort(
      (a, b) =>
        ['raider', 'interceptor', 'corsair', 'smuggler', 'scout'].indexOf(a.role) -
        ['raider', 'interceptor', 'corsair', 'smuggler', 'scout'].indexOf(b.role),
    )) {
    if (!available(e, leader)) continue;
    const nearby = fleet(e)
      .filter(
        (s) =>
          s.id !== leader.id &&
          ['raider', 'interceptor', 'corsair'].includes(s.role) &&
          available(e, s) &&
          dist(s, leader) < 320,
      )
      .sort((a, b) => dist(a, leader) - dist(b, leader) || a.id.localeCompare(b.id));
    const fighters = [leader, ...nearby].slice(0, 5);
    const capacity = fighters.reduce((n, s) => n + capabilities(s).cargo - cargoUsed(s), 0);
    const power = fighters.reduce((n, s) => n + combatStrength(s), 0);
    const candidates = localReports(e, leader)
      .filter(
        (r) =>
          w.time - r.seenAt <= R.tacticalTTL &&
          r.cargoEstimate >= 20 &&
          !w.orion.robbedTargets[r.id] &&
          !w.orion.operations.some((op) => op.status === 'active' && op.targetId === r.id),
      )
      .map((r) => {
        const escort = r.escorts.reduce((n, s) => n + s.strength, 0),
          defense = r.defense + escort;
        const loot =
          Math.min(r.cargoEstimate * R.boardingFraction, capacity) *
          (r.value / Math.max(1, r.cargoEstimate));
        const travel = dist(leader, r) / Math.min(...fighters.map((s) => capabilities(s).warp));
        const home = retreatBase(e, leader),
          returnCost = home ? dist(r, home) / capabilities(leader).warp : 60;
        const score =
          loot * (1 - (w.time - r.seenAt) / R.reportTTL) -
          defense * 0.18 -
          travel * 5 -
          returnCost * 0.6 -
          Math.max(0, defense - power) * 0.8;
        return { r, score, safe: escort < power * 0.65 && defense < power * 1.55 };
      })
      .filter((c) => c.safe && c.score > 30)
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
    const best = candidates[0];
    if (!best) continue;
    const r = best.r,
      rendezvous = {
        x: fighters.reduce((n, s) => n + s.x, 0) / fighters.length,
        y: fighters.reduce((n, s) => n + s.y, 0) / fighters.length,
      };
    const lead =
      dist(rendezvous, r) / Math.max(1, Math.max(...fighters.map((s) => capabilities(s).warp)));
    const members: OrionOperation['members'] = fighters.map((s, i) => ({
      shipId: s.id,
      duty:
        s.role === 'interceptor'
          ? 'intercept'
          : s.role === 'corsair'
            ? 'cover'
            : i % 2
              ? 'flank'
              : 'loot',
    }));
    const transport = fleet(e).find(
      (s) =>
        s.role === 'smuggler' &&
        !members.some((m) => m.shipId === s.id) &&
        dist(s, leader) <= R.communicationRange &&
        available(e, s) &&
        dist(s, r) < 600 &&
        r.cargoEstimate > capacity * 1.5,
    );
    if (transport) members.push({ shipId: transport.id, duty: 'transport' });
    const op: OrionOperation = {
      id: 'orion-operation-' + w.nextId++,
      targetId: r.id,
      members,
      phase: 'assemble',
      status: 'active',
      created: w.time,
      phaseAt: w.time,
      report: structuredClone(r),
      motion: { x: r.x, y: r.y, observedAt: r.seenAt },
      rendezvous,
      intercept: predictedPosition(r, w.time, lead),
      incidentId: null,
      work: 0,
      transferWork: 0,
      initialCargo: r.cargoEstimate,
      limit: 0,
      taken: 0,
      reason: '',
    };
    w.orion.operations.push(op);
    ledger(e, 'operationStarted', op.id);
    for (const m of members) {
      const s = fleet(e).find((s) => s.id === m.shipId)!;
      s.intent = 'assemble';
      s.targetId = r.id;
    }
  }
}
function visibleTarget(
  e: SimulationEngine,
  op: OrionOperation,
  members: Enemy[],
): Ship | Location | undefined {
  const t =
    e.state.ships.find((s) => s.id === op.targetId) ??
    e.state.civilians.find((s) => s.id === op.targetId) ??
    e.state.locations.find((l) => l.id === op.targetId && l.owner === 'starfleet');
  if (!t || t.hull <= 0) return;
  return members.some((s) =>
    'classId' in t ? canDetectShip(s, t, e.state.time) : dist(s, t) <= capabilities(s).sensors,
  )
    ? t
    : undefined;
}
function hostileCover(e: SimulationEngine, op: OrionOperation, members: Enemy[]) {
  return [
    ...e.state.ships,
    ...e.state.civilians,
    ...e.state.locations.filter((l) => l.owner === 'starfleet'),
  ]
    .filter(
      (t) =>
        t.id !== op.targetId &&
        t.hull > 0 &&
        members.some((s) =>
          'classId' in t ? canDetectShip(s, t, e.state.time) : dist(s, t) < capabilities(s).sensors,
        ) &&
        dist(t, predictedPosition(op.report, e.state.time)) <
          ('classId' in t ? 320 : facilityCapabilities(t).range + 40),
    )
    .sort((a, b) => unitStrength(b) - unitStrength(a) || a.id.localeCompare(b.id));
}
function lootToSmuggler(e: SimulationEngine, op: OrionOperation, members: Enemy[], dt: number) {
  const transport = members.find(
    (s) => s.role === 'smuggler' && capabilities(s).cargo - cargoUsed(s) > 0,
  );
  if (!transport) return false;
  const donor = members.find(
    (s) => s.id !== transport.id && s.loot > 0 && dist(s, transport) < 100,
  );
  if (!donor) return false;
  op.transferWork += dt;
  if (op.transferWork >= 2 && dist(donor, transport) <= R.transferRange) {
    const goods = transferCargo(e, donor, transport, R.transferRate * dt);
    if (goodsCount(goods) > 0) ledger(e, 'lootTransshipment', transport.id, 0, goods);
  }
  return true;
}
function advanceOperation(
  e: SimulationEngine,
  op: OrionOperation,
  dt: number,
  evading: Set<string>,
) {
  const all = fleet(e).filter((s) => op.members.some((m) => m.shipId === s.id));
  const members = all.filter((s) => !evading.has(s.id));
  if (!all.length) {
    op.status = 'aborted';
    op.reason = '编队永久损失';
    const incident = e.state.piracyIncidents.find((i) => i.id === op.incidentId);
    if (incident) resolveIncident(e, incident, '海盗编队已被消灭');
    return;
  }
  if (op.phase === 'withdraw' || op.phase === 'resupply') {
    for (const s of members) {
      const home = retreatBase(e, s);
      const cargoEscaping = all.some((t) => t.loot > 0 && t.id !== s.id && dist(s, t) < 130);
      const pursuer = s.lastAttackerId
        ? e.state.ships.find(
            (t) =>
              t.id === s.lastAttackerId &&
              canDetectShip(s, t, e.state.time) &&
              e.state.time - s.attackedAt < 12,
          )
        : undefined;
      if (s.loot === 0 && cargoEscaping && pursuer && dist(s, pursuer) < 140) {
        e.fire(s, pursuer, 'warning');
        move(s, all.find((t) => t.loot > 0)!, dt);
      } else if (home) {
        s.intent = 'retreat';
        serviceOrion(e, s, dt);
      } else {
        s.intent = 'observe';
        if (s.destination) move(s, s.destination, dt);
      }
    }
    if (
      all.every((s) => s.loot <= 1e-8 && s.intent !== 'retreat' && !s.counterTracking.evading) ||
      !operatingHomeExists(e)
    ) {
      op.status = op.taken > 0 ? 'complete' : 'aborted';
      op.phase = 'resupply';
    }
    return;
  }
  const fresh = all
    .flatMap((s) => localReports(e, s))
    .filter((r) => r.id === op.targetId)
    .sort((a, b) => b.seenAt - a.seenAt || a.observerId.localeCompare(b.observerId))[0];
  if (fresh && fresh.seenAt > op.report.seenAt) op.report = structuredClone(fresh);
  const target = visibleTarget(e, op, members),
    cover = hostileCover(e, op, members),
    power = members.reduce((n, s) => n + combatStrength(s), 0);
  const observedSpeed =
    target && e.state.time > op.motion.observedAt
      ? dist(target, op.motion) / (e.state.time - op.motion.observedAt)
      : Math.hypot(op.report.velocity.x, op.report.velocity.y);
  if (target) op.motion = { x: target.x, y: target.y, observedAt: e.state.time };
  if (
    all.some(
      (s) =>
        s.hull < capabilities(s).hull * 0.45 ||
        s.engines < 30 ||
        s.core < capabilities(s).core * 0.2,
    ) ||
    cover.reduce((n, s) => n + unitStrength(s), 0) > power * 0.85
  ) {
    withdrawOperation(e, op, '实际观测到不可承担的战斗风险');
    return;
  }
  if (e.state.time - op.report.seenAt > R.tacticalTTL) {
    withdrawOperation(e, op, '目标信号失联，预测搜索已到限度');
    return;
  }
  if (target && ('cargo' in target ? cargoUsed(target) : goodsCount(target.stock)) <= 0) {
    withdrawOperation(e, op, '目标已无可掠夺货物');
    return;
  }
  if (op.phase === 'assemble') {
    for (const s of members) {
      s.destination = op.rendezvous;
      move(s, op.rendezvous, dt);
    }
    if (members.length === all.length && members.every((s) => dist(s, op.rendezvous) < 45))
      changePhase(e, op, 'deploy');
    return;
  }
  const at = target ? { x: target.x, y: target.y } : predictedPosition(op.report, e.state.time);
  if (op.phase === 'deploy' || op.phase === 'ambush') {
    if (target && members.some((s) => dist(s, target) < 150)) {
      const free = members.reduce((n, s) => n + capabilities(s).cargo - cargoUsed(s), 0);
      op.initialCargo = op.report.cargoEstimate;
      op.limit = Math.min(op.report.cargoEstimate * R.boardingFraction, free);
      if ('classId' in target) {
        const sender = members.find((s) => dist(s, target) < 150)!;
        const demand = Math.min(
          Math.floor(op.report.cargoEstimate * R.demandFraction),
          Math.floor(free),
        );
        const incident = openIncident(e, target, sender, demand);
        op.incidentId = incident.id;
        changePhase(e, op, 'extort');
      } else changePhase(e, op, 'disable');
      return;
    }
    const bearing = Math.atan2(op.report.velocity.y, op.report.velocity.x);
    for (const s of members) {
      const slot = op.members.findIndex((m) => m.shipId === s.id),
        duty = op.members[slot].duty;
      const lead = duty === 'intercept' ? Math.min(12, dist(s, at) / capabilities(s).warp) : 2;
      const goal = predictedPosition(op.report, e.state.time, lead);
      const side = duty === 'flank' ? -1 : 1;
      goal.x += Math.cos(bearing + Math.PI / 2) * side * 35;
      goal.y += Math.sin(bearing + Math.PI / 2) * side * 35;
      s.intent = 'ambush';
      s.destination = goal;
      move(s, goal, dt);
    }
    if (op.phase === 'deploy') changePhase(e, op, 'ambush');
    return;
  }
  if (!target) {
    for (const s of members) move(s, at, dt);
    op.work = 0;
    const incident = e.state.piracyIncidents.find((i) => i.id === op.incidentId);
    if (incident) incident.boardingWork = 0;
    return;
  }
  const incident = e.state.piracyIncidents.find((i) => i.id === op.incidentId);
  if (op.phase === 'extort' && incident) {
    for (const s of members) {
      s.intent = 'extort';
      move(s, target, dt);
    }
    if (incident.response === 'comply') {
      incident.stage = 'transferring';
      op.work += dt;
      if (op.work >= 2)
        for (const s of members) {
          const remaining = Math.max(0, incident.demand - goodsCount(incident.lost));
          const goods = transferCargo(
            e,
            target,
            s,
            Math.min(R.transferRate * dt, remaining),
            incident,
            true,
          );
          op.taken += goodsCount(goods);
        }
      if (
        goodsCount(incident.lost) + 1e-8 >= incident.demand ||
        ('cargo' in target && cargoUsed(target) <= 1e-8)
      ) {
        withdrawOperation(e, op, '交货履约，载货编队撤离');
        return;
      }
    } else if (incident.response === 'refuse' || e.state.time >= incident.deadline) {
      incident.response = 'refuse';
      incident.stage = 'attacked';
      changePhase(e, op, 'disable');
    }
    return;
  }
  const shieldMax = 'classId' in target ? capabilities(target).shield : target.maxShield;
  const vulnerable =
    target.shield <= shieldMax * 0.05 &&
    (!('classId' in target) || (target.engines <= 20 && observedSpeed <= 1.5));
  for (const s of members) {
    const duty = op.members.find((m) => m.shipId === s.id)!.duty;
    s.intent = op.phase === 'board' ? 'board' : 'disable';
    if (duty === 'transport') {
      const donor = members.find((t) => t.id !== s.id && t.loot > 0 && dist(t, s) < 100);
      move(s, donor ?? { x: target.x + 65, y: target.y + 65 }, dt);
      continue;
    }
    if (duty === 'cover' && cover[0]) {
      move(s, cover[0], dt);
      e.fire(s, cover[0], 'warning');
      continue;
    }
    move(s, target, dt);
    const hullMax = 'classId' in target ? capabilities(target).hull : target.maxHull;
    if (!vulnerable && target.hull > hullMax * 0.4)
      e.fire(
        s,
        target,
        'classId' in target
          ? s.modules.includes('precisionTargeting')
            ? 'engines'
            : 'suppression'
          : 'suppression',
      );
  }
  if (vulnerable) {
    if (op.phase !== 'board') {
      changePhase(e, op, 'board');
      if (incident) incident.stage = 'boarding';
    }
    const boarders = members.filter(
      (s) =>
        op.members.find((m) => m.shipId === s.id)?.duty !== 'transport' &&
        dist(s, target) <= R.transferRange &&
        capabilities(s).cargo > cargoUsed(s),
    );
    if (boarders.length) op.work += dt;
    else op.work = 0;
    if (incident) incident.boardingWork = Math.min(R.boardingMinutes, op.work);
    if (op.work + 1e-8 >= R.boardingMinutes)
      for (const s of boarders) {
        const goods = transferCargo(
          e,
          target,
          s,
          Math.min(R.transferRate * dt, op.limit - op.taken),
          incident,
        );
        op.taken += goodsCount(goods);
      }
    lootToSmuggler(e, op, members, dt);
    if (
      op.taken + 1e-8 >= op.limit ||
      members.every((s) => capabilities(s).cargo - cargoUsed(s) < 1) ||
      ('cargo' in target ? cargoUsed(target) : goodsCount(target.stock)) <= 1e-8
    ) {
      withdrawOperation(e, op, '掠夺额度已达，优先保全赃物');
      return;
    }
  } else if (op.phase === 'board') {
    changePhase(e, op, 'disable');
    if (incident) {
      incident.stage = 'attacked';
      incident.boardingWork = 0;
    }
  }
  if (e.state.time - op.phaseAt > 35 && op.phase === 'disable')
    withdrawOperation(e, op, '无法低成本瘫痪目标');
}
const operatingHomeExists = (e: SimulationEngine) =>
  e.state.locations.some((l) => l.owner === 'orion' && l.hull > 0 && !l.occupation);
export function patrolOrion(e: SimulationEngine, s: Enemy, dt: number) {
  if (e.state.time < s.nextDecision) {
    if (s.destination) move(s, s.destination, dt);
    return;
  }
  const o = e.state.orion;
  const build = o.jobs.find((j) => j.status === 'active' && j.builderId === s.id);
  if (build) {
    s.destination = build.point;
    move(s, build.point, dt);
    return;
  }
  if (s.role === 'smuggler' && cargoUsed(s) > 0 && operatingHomeExists(e)) {
    s.intent = 'retreat';
    serviceOrion(e, s, dt);
    return;
  }
  const reports = localReports(e, s)
    .filter(
      (r) =>
        r.kind === 'ship' &&
        r.value > 0 &&
        e.state.time - r.seenAt < R.tacticalTTL &&
        !o.robbedTargets[r.id],
    )
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const useful = reports[0];
  if (useful && s.role === 'scout') {
    s.targetId = useful.id;
    const home = retreatBase(e, s);
    const shared = fleet(e).some(
      (peer) =>
        peer.id !== s.id &&
        ['raider', 'interceptor'].includes(peer.role) &&
        localReports(e, peer).some((r) => r.id === useful.id && r.seenAt >= useful.seenAt),
    );
    s.destination =
      !shared && home && dist(s, home) > R.communicationRange
        ? { x: home.x, y: home.y }
        : predictedPosition(useful, e.state.time, 1);
    move(s, s.destination, dt);
    return;
  }
  const home = retreatBase(e, s);
  const p = (o.patrols[s.id] ??= {
    anchor: home ? { x: home.x, y: home.y } : { x: s.x, y: s.y },
    leg: 0,
  });
  const radius = s.role === 'corsair' ? 100 : 150 + Math.floor(p.leg / 8) * 70;
  const angle = ((p.leg % 8) * Math.PI) / 4;
  const destination = {
    x: p.anchor.x + Math.cos(angle) * radius,
    y: p.anchor.y + Math.sin(angle) * radius,
  };
  s.intent = 'observe';
  s.targetId = null;
  s.destination = destination;
  if (move(s, destination, dt) || dist(s, destination) < 10) {
    p.leg++;
    if (p.leg > 32) {
      p.anchor = { x: destination.x, y: destination.y };
      p.leg = 0;
    }
  }
}
export function advanceOrion(e: SimulationEngine, dt: number) {
  const ships = fleet(e),
    evading = new Set<string>();
  for (const s of ships) {
    regenerate(s, e.state.time, dt);
    if (advanceEvasion(e, s, dt)) evading.add(s.id);
  }
  if (e.state.tick % 10 === 0) observeOrion(e);
  planOrion(e);
  for (const op of e.state.orion.operations.filter((op) => op.status === 'active'))
    advanceOperation(e, op, dt, evading);
  for (const s of ships.filter((s) => !evading.has(s.id) && !assigned(e, s.id))) {
    if (s.hull <= 0) continue;
    if (s.intent === 'observe' && e.state.time < s.nextDecision && !s.destination) continue;
    if (advanceProvisioning(e, s, dt)) continue;
    if (
      s.hull < capabilities(s).hull * 0.45 ||
      s.engines < 30 ||
      (s.loot > 0 && operatingHomeExists(e))
    )
      s.intent = 'retreat';
    if (['retreat', 'docked'].includes(s.intent) && serviceOrion(e, s, dt)) continue;
    if (advanceOrionLogistics(e, s, dt)) continue;
    patrolOrion(e, s, dt);
    const attacker = e.state.ships.find(
      (t) =>
        t.id === s.lastAttackerId &&
        e.state.time - s.attackedAt < 12 &&
        canDetectShip(s, t, e.state.time),
    );
    if (attacker) e.fire(s, attacker, 'warning');
  }
  advanceOrionEconomy(e, dt);
}
