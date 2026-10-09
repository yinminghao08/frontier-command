import { recordCargoTransfer } from '../agent-runtime/journal';
import type { Enemy, Location, PiracyIncident, Ship, Stock } from '../types';
import { GOODS } from '../types';
import type { SimulationEngine } from '../engine';
import { emptyStock } from '../data';
import { capabilities, cargoUsed } from '../capabilities';
import { dist } from '../navigation';
import { loseStock } from '../inventory';
import { ORION_RULES as R } from '../definitions/orion';
import { combatStrength } from './intelligence';
import { observe } from '../sensors';

export const goodsCount = (stock: Stock) => GOODS.reduce((n, k) => n + stock[k], 0);
/** Transfers happen at physical range and debit exactly what fits; all loss attribution is here. */
export function transferCargo(
  e: SimulationEngine,
  source: Ship | Location,
  recipient: Enemy,
  limit: number,
  incident?: PiracyIncident,
  voluntary = false,
) {
  const out = emptyStock();
  if (
    source.hull <= 0 ||
    recipient.hull <= 0 ||
    dist(source, recipient) > R.transferRange ||
    limit <= 0
  )
    return out;
  let free = Math.min(limit, capabilities(recipient).cargo - cargoUsed(recipient));
  const order = voluntary
    ? [...GOODS]
    : [...GOODS].sort((a, b) => R.marketPrices[b] - R.marketPrices[a]);
  for (const k of order) {
    let n = Math.max(0, Math.min(free, 'cargo' in source ? source.cargo[k] : source.stock[k]));
    if (k !== 'materials') n = Math.floor(n);
    if (n <= 0) continue;
    if ('cargo' in source) {source.cargo[k] -= n;recordCargoTransfer(e,source.id,source.id,recipient.id,k,n,'lost',source.current??undefined);}
    else n = loseStock(e, source, k, n);
    recipient.cargo[k] += n;
    out[k] = n;
    free -= n;
    if ('factionId' in source && source.factionId === 'orion') {
      const previous = e.state.orion.lootCargo[source.id] ?? emptyStock();
      const stolen = Math.min(previous[k], n);
      previous[k] -= stolen;
      (e.state.orion.lootCargo[recipient.id] ??= emptyStock())[k] += stolen;
      (source as Enemy).loot = goodsCount(previous);
    } else {
      (e.state.orion.lootCargo[recipient.id] ??= emptyStock())[k] += n;
      if (incident) incident.lost[k] += n;
      if ('cargo' in source) {
        const d = source.current;
        if (d?.action.type === 'HAUL' && d.action.cargoKind === k)
          d.lost =
            (d.lost ?? 0) + Math.min(n, Math.max(0, d.carried - d.delivered - (d.lost ?? 0)));
        const o = e.state.trade.orders.find(
          (o) => o.carrierId === source.id && o.state === 'delivery' && o.cargoKind === k,
        );
        if (o) o.lost = (o.lost ?? 0) + n;
      }
    }
  }
  recipient.loot = goodsCount(e.state.orion.lootCargo[recipient.id] ?? emptyStock());
  return out;
}
export function openIncident(
  e: SimulationEngine,
  target: Ship,
  sender: Enemy,
  demand: number,
): PiracyIncident {
  const w = e.state;
  const record = observe(w, sender, 3).record;
  record.hostile = true;
  record.lastAttackTargetId = target.id;
  record.lastAttackAt = w.time;
  sender.lastHostileAt = w.time;
  sender.lastHostileTargetId = target.id;
  const incident: PiracyIncident = {
    id: 'piracy-' + w.nextId++,
    shipId: target.id,
    created: w.time,
    deadline: w.time + R.demandMinutes,
    demand: Math.max(0, Math.floor(demand)),
    response: 'pending',
    responseSource: null,
    stage: 'demand',
    boardingWork: 0,
    lost: emptyStock(),
    attackerIds: [sender.id],
    outcome: '',
    notifiedAgentIds: [],
  };
  w.piracyIncidents.push(incident);
  e.report(
    target.name +
      ' 收到 Orion 勒索：交出至多 ' +
      incident.demand +
      ' 单位货物，期限8游戏分钟。可交货、脱离或请求护航。',
    target.id,
    'urgent',
    'threat',
  );
  e.record('piracyDemand', target.name + ' 收到实际近距勒索通信', target.id, false);
  return incident;
}
export function resolveIncident(e: SimulationEngine, incident: PiracyIncident, text: string) {
  if (incident.stage === 'resolved') return;
  incident.stage = 'resolved';
  incident.outcome = text;
  const lost = goodsCount(incident.lost);
  e.record('cargoLoss', text + ' · 实际货损 ' + lost.toFixed(1), incident.shipId, false);
  e.report(
    text + ' · 实际货损 ' + lost.toFixed(1),
    incident.shipId,
    lost ? 'high' : 'normal',
    'threat',
  );
}
export function applyCargoPolicy(e: SimulationEngine, ship: Ship, incident: PiracyIncident) {
  if (
    incident.responseSource === 'admiral' ||
    incident.response !== 'pending' ||
    ship.piracyPolicy === 'manual'
  )
    return;
  const own = capabilities(ship);
  const hostiles = e.state.intel.filter(
    (i) => i.live && (i.hostile || i.factionId === 'orion') && !i.resolved && dist(i, ship) < 260,
  );
  const threat = hostiles.reduce(
    (n, i) => n + (i.classId ? (i.hull ?? 80) + (i.shield ?? 50) : 160),
    0,
  );
  const cover = e.state.ships
    .filter((s) => s.id !== ship.id && s.hull > 0 && dist(s, ship) < 180)
    .reduce((n, s) => n + combatStrength(s), 0);
  const relief = e.state.ships.some(
    (s) =>
      s.id !== ship.id &&
      s.current?.action.type === 'ESCORT' &&
      s.current.action.targetId === ship.id &&
      dist(s, ship) / capabilities(s).warp <= Math.max(0, incident.deadline - e.state.time),
  );
  const canEscape =
    ship.engines > 50 &&
    hostiles.every((i) => own.warp > Math.hypot(i.velocity.x, i.velocity.y) * 1.15 + 1) &&
    own.warp >= 8;
  const desperate = ship.hull / own.hull < 0.3;
  const unfavorable = threat > ship.hull + ship.shield + cover * 0.7;
  if (
    (ship.piracyPolicy === 'preserveCargo' ? desperate : unfavorable || desperate) &&
    !relief &&
    !canEscape
  ) {
    incident.response = 'comply';
    incident.responseSource = 'policy';
  }
}
export function advancePiracyPolicies(e: SimulationEngine) {
  for (const incident of e.state.piracyIncidents.filter((i) => i.stage !== 'resolved')) {
    const ship =
      e.state.ships.find((s) => s.id === incident.shipId) ??
      e.state.civilians.find((s) => s.id === incident.shipId);
    if (!ship) {
      resolveIncident(e, incident, '遇袭舰船永久损失');
      continue;
    }
    applyCargoPolicy(e, ship, incident);
  }
}
/** Voluntary transfer holds navigation only while both real participants remain alongside. */
export function piracyTransferHolds(e: SimulationEngine, ship: Ship) {
  return e.state.piracyIncidents.some(
    (i) =>
      i.shipId === ship.id &&
      i.stage === 'transferring' &&
      i.response === 'comply' &&
      i.attackerIds.some((id) =>
        e.state.enemies.some((s) => s.id === id && s.hull > 0 && dist(s, ship) <= R.transferRange),
      ),
  );
}
