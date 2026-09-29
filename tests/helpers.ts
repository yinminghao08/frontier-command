import { SimulationEngine } from '../src/engine/engine';
import { defaultOrder } from '../src/engine/data';
import type { OrderKind, OrderSpec } from '../src/engine/types';
export function quietEngine() {
  const e = new SimulationEngine();
  e.state.enemies = [];
  e.state.nextIncursion = 1e9;
  return e;
}
export function spec(
  kind: OrderKind,
  shipId = kind === 'transport' ? 'meridian' : kind === 'explore' ? 'verity' : 'vigil',
): OrderSpec {
  return { ...defaultOrder(kind), shipIds: [shipId] };
}
export function run(e: SimulationEngine, minutes: number) {
  for (let i = 0; i < minutes * 10; i++) {
    if (e.state.paused) e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
}
export function until(e: SimulationEngine, predicate: () => boolean, maxMinutes = 600) {
  for (let i = 0; i < maxMinutes * 10 && !predicate(); i++) {
    if (e.state.paused) e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
  if (!predicate()) throw Error('Simulation predicate timed out at ' + e.state.time);
}
