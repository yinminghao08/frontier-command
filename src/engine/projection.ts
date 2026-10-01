import type { SimulationEngine } from './engine';
import { visibleIntel } from './sensors';
import type { Observation, Snapshot } from './types';

export function snapshot(this: SimulationEngine): Snapshot {
  const w = this.state;
  return structuredClone({
    version: w.version,
    tick: w.tick,
    time: w.time,
    paused: w.paused,
    speed: w.speed,
    pauseReasons: w.pauseReasons,
    commander: w.commander,
    operators: w.operators,
    assignments: w.assignments,
    losses: w.losses,
    status: w.status,
    armory: w.armory,
    ships: w.ships,
    contacts: visibleIntel(w),
    orders: w.orders,
    locations: w.locations.map((l) =>
      l.regionId === 'romulan'
        ? {
            ...l,
            stock: { supplies: 0, medical: 0, materials: 0 },
            reserved: { supplies: 0, medical: 0, materials: 0 },
            hull: 0,
            maxHull: 0,
            shield: 0,
            maxShield: 0,
            attackedAt: -1000,
            hazard: 0,
            surveyed: false,
            surveyRevision: 0,
            rewardedRevision: 0,
            distress: false,
          }
        : l,
    ),
    resources: w.resources,
    communications: w.communications,
    logs: w.logs,
    beams: w.beams,
    explored: w.explored,
  });
}
export function getObservation(this: SimulationEngine, operatorId: string): Observation | null {
  const operator = this.state.operators.find((o) => o.id === operatorId),
    assignment = this.state.assignments.find((a) => a.operatorId === operator?.id),
    ship = this.state.ships.find((s) => s.id === assignment?.shipId);
  if (!ship) return null;
  return structuredClone({
    time: this.state.time,
    operatorId,
    ship,
    contacts: visibleIntel(this.state),
    orders: this.state.orders.filter((o) => o.shipIds.includes(ship.id)),
    legalActions: ['scan', 'recall', 'repair'].filter(
      (type) => this.validate({ type, shipId: ship.id }, operatorId).ok,
    ),
  });
}
