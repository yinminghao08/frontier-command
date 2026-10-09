import type { SimulationEngine } from '../engine';
import type { CargoKind, Directive, Stock } from '../types';
import type { DomainEvent, TaskStatus } from './model';
import { GOODS } from '../types';

type EventInput = DomainEvent extends infer E
  ? E extends DomainEvent
    ? Omit<E, 'eventId' | 'sequence' | 'simulationTick'>
    : never
  : never;
export function emitDomainEvent(e: SimulationEngine, event: EventInput): DomainEvent {
  const sequence = e.state.agentRuntime.nextEvent++;
  const result = {
    ...event,
    eventId: 'domain:' + sequence,
    sequence,
    simulationTick: e.state.tick,
  } as DomainEvent;
  e.state.agentRuntime.events.push(result);
  return result;
}
export function transitionEvent(
  e: SimulationEngine,
  taskId: string,
  objectiveId: string,
  from: TaskStatus,
  to: TaskStatus,
  reason: string | null,
) {
  return emitDomainEvent(e, {
    type: 'taskTransition',
    sourceId: taskId,
    taskId,
    objectiveId,
    directiveId: null,
    payload: { from, to, reason },
  });
}
export function recordCargoTransfer(
  e: SimulationEngine,
  shipId: string,
  sourceId: string | null,
  targetId: string | null,
  cargoKind: CargoKind,
  amount: number,
  disposition: 'loaded' | 'delivered' | 'consumed' | 'lost',
  d?: Directive,
) {
  if (amount <= 0) return;
  const ship = e.state.ships.find((s) => s.id === shipId);
  if (ship) {
    const before = { ...ship.cargo };
    before[cargoKind] += disposition === 'loaded' ? -amount : amount;
    seedCargoLots(e, shipId, before);
  }
  const r = e.state.agentRuntime;
  const taskId = d?.taskId && r.tasks.some((t) => t.taskId === d.taskId) ? d.taskId : null;
  const objectiveId = taskId ? r.tasks.find((t) => t.taskId === taskId)!.objectiveId : null;
  if (disposition === 'loaded') {
    r.cargoLots.push({
      lotId: 'lot:' + r.nextLot++,
      shipId,
      taskId,
      sourceId,
      cargoKind,
      amount,
      acquiredTick: e.state.tick,
    });
    emitDomainEvent(e, {
      type: 'cargoTransfer',
      sourceId: sourceId ?? shipId,
      objectiveId,
      taskId,
      directiveId: d?.id ?? null,
      payload: { shipId, sourceId, targetId, cargoKind, amount, disposition },
    });
    return;
  }
  let left = amount;
  // Goods are fungible. Oldest batches leave first, so unrelated existing cargo
  // cannot be re-labelled as newly recovered task cargo.
  for (const lot of r.cargoLots
    .filter((l) => l.shipId === shipId && l.cargoKind === cargoKind && l.amount > 0)
    .sort(
      (a, b) =>
        a.acquiredTick - b.acquiredTick ||
        a.lotId.localeCompare(b.lotId, undefined, { numeric: true }),
    )) {
    if (left <= 1e-8) break;
    const n = Math.min(left, lot.amount);
    lot.amount -= n;
    left -= n;
    const owner = r.tasks.find((t) => t.taskId === lot.taskId);
    emitDomainEvent(e, {
      type: 'cargoTransfer',
      sourceId: shipId,
      objectiveId: owner?.objectiveId ?? null,
      taskId: owner?.taskId ?? null,
      directiveId: d?.id ?? null,
      payload: { shipId, sourceId: lot.sourceId, targetId, cargoKind, amount: n, disposition },
    });
  }
  if (left > 1e-8)
    emitDomainEvent(e, {
      type: 'cargoTransfer',
      sourceId: shipId,
      objectiveId: null,
      taskId: null,
      directiveId: d?.id ?? null,
      payload: { shipId, sourceId: null, targetId, cargoKind, amount: left, disposition },
    });
  r.cargoLots = r.cargoLots.filter((l) => l.amount > 1e-8);
}
export function seedCargoLots(e: SimulationEngine, shipId: string, cargo: Stock) {
  for (const cargoKind of GOODS) {
    const tracked = e.state.agentRuntime.cargoLots
      .filter((l) => l.shipId === shipId && l.cargoKind === cargoKind)
      .reduce((n, l) => n + l.amount, 0);
    const amount = cargo[cargoKind] - tracked;
    if (amount > 1e-8)
      e.state.agentRuntime.cargoLots.push({
        lotId: 'lot:' + e.state.agentRuntime.nextLot++,
        shipId,
        taskId: null,
        sourceId: null,
        cargoKind,
        amount,
        acquiredTick: e.state.tick,
      });
  }
}
