import type { SimulationEngine } from './engine';
import type { Directive, Ship } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { available, inventory } from './inventory';
import { dist } from './navigation';
import { makeDirective, validateAction } from './command-system';
import { regionAt } from './definitions/locations';
export function groupPeers(e: SimulationEngine, d: Directive) {
  return d.groupOrderId
    ? e.state.ships
        .filter((s) => s.current?.groupOrderId === d.groupOrderId)
        .sort((a, b) => a.current!.groupSlot - b.current!.groupSlot)
    : [];
}
export function groupSpeed(e: SimulationEngine, s: Ship, d: Directive) {
  const peers = groupPeers(e, d);
  if (peers.length < 2) return 1;
  const speed = Math.min(...peers.map((p) => capabilities(p).warp));
  const destination = s.path.at(-1) ?? peers.find((p) => p.path.length)?.path.at(-1);
  const lead = destination
    ? Math.max(...peers.map((p) => dist(p, destination))) - dist(s, destination)
    : 0;
  return (speed / capabilities(s).warp) * (lead > Math.max(60, d.groupSpacing * 3) ? 0.2 : 1);
}
export function prepareGroupHaul(e: SimulationEngine, d: Directive) {
  const peers = groupPeers(e, d).filter((s) => s.current?.action.type === 'HAUL');
  if (!peers.length || d.action.type !== 'HAUL') return;
  if (peers.some((s) => s.current!.phase !== 'starting')) return;
  const src = inventory(e.state, d.action.sourceId);
  if (!src || peers.some((s) => dist(s, src) > 10)) return;
  let left = Math.min(
    d.groupTotal,
    Math.floor(available(e.state, src.id, d.action.cargoKind)),
    peers.reduce((n, s) => n + Math.floor(capabilities(s).cargo - cargoUsed(s)), 0),
  );
  if (!left) return;
  for (const s of peers) {
    const order = s.current!,
      amount = Math.min(left, Math.floor(capabilities(s).cargo - cargoUsed(s)));
    left -= amount;
    order.reserved[d.action.cargoKind] = amount;
    order.phase = 'loading';
    order.work = 0;
  }
}
export function hasAdmiralWork(s: Ship) {
  return [s.current, ...s.queue, ...s.suspended].some((d) => d?.source === 'admiral');
}
export function autonomousAllowed(s: Ship, p: { x: number; y: number }) {
  const region = regionAt(p.x, p.y);
  return (
    (region !== 'neutral' || s.standing.allowNeutral) &&
    (region !== 'romulan' || s.standing.allowRomulan)
  );
}
export function advanceStanding(e: SimulationEngine, s: Ship) {
  if (hasAdmiralWork(s)) return;
  const c = capabilities(s),
    o = s.standing,
    low =
      (s.hull / c.hull) * 100 < o.retreatHull ||
      (s.shield / c.shield) * 100 < o.retreatShield ||
      (s.core / c.core) * 100 < o.retreatCore;
  const ammo =
    (c.photon > 0 && (s.photon / c.photon) * 100 < o.photonThreshold) ||
    (c.quantum > 0 && (s.quantum / c.quantum) * 100 < o.quantumThreshold);
  const start = (action: Directive['action']) => {
    if (!validateAction(e, s, action).ok) return;
    const d = makeDirective(e, action);
    d.source = 'standing';
    d.origin = { x: s.x, y: s.y };
    s.current = d;
    s.path = [];
    s.status = 'active';
  };
  if (
    (low || (o.autoResupply && ammo)) &&
    dist(s, e.base) > 30 &&
    s.current?.action.type !== 'RETURN'
  ) {
    s.current = null;
    start({ type: 'RETURN' });
    return;
  }
  if (s.current) return;
  if (o.autoResupply && dist(s, e.base) < 30) {
    if (s.hull < c.hull && available(e.state, 'base', 'materials') > 0) {
      start({ type: 'REPAIR', targetId: 'base' });
      return;
    }
    const photon = Math.min(c.photon - s.photon, Math.floor(available(e.state, 'base', 'photon'))),
      quantum = Math.min(c.quantum - s.quantum, Math.floor(available(e.state, 'base', 'quantum')));
    if (photon + quantum > 0) {
      start({ type: 'REARM', targetId: 'base', load: { photon, quantum } });
      return;
    }
  }
  if (o.respondDistress) {
    const event = e.state.events.find((v) => v.stage === 'reported' && v.kind === 'distress');
    const target =
      event &&
      [...e.state.locations, ...e.state.ships, ...e.state.civilians].find(
        (x) => x.id === event.subjectId,
      );
    if (event && target && dist(s, target) <= o.maxPursuit && autonomousAllowed(s, target)) {
      start({ type: 'ASSIST_EVENT', targetId: event.id });
      return;
    }
  }
  if (o.autoEscort || o.protectFreighter || o.protectCivilian) {
    const ship = [
      ...(o.autoEscort || o.protectFreighter ? e.state.ships : []),
      ...(o.autoEscort || o.protectCivilian ? e.state.civilians : []),
    ].find(
      (x) =>
        x.id !== s.id &&
        (x.current?.action.type === 'HAUL' || ('phase' in x && x.phase === 'delivery')) &&
        dist(s, x) < o.maxPursuit &&
        autonomousAllowed(s, x),
    );
    if (ship) {
      start({ type: 'ESCORT', targetId: ship.id });
      return;
    }
  }
  if (o.protectColony) {
    const colony = e.state.locations.find(
      (l) =>
        l.kind === 'colony' &&
        l.distress &&
        l.hull > 0 &&
        dist(s, l) <= o.maxPursuit &&
        autonomousAllowed(s, l),
    );
    if (colony) {
      start({ type: 'PATROL', targetId: colony.id, duration: 30 });
      return;
    }
  }
  if (o.idle === 'return' && dist(s, e.base) > 30) start({ type: 'RETURN' });
  else if (dist(s, e.base) <= 30) s.status = 'docked';
}
