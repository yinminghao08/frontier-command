import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/engine';
import { quietEngine, run, spec } from './helpers';
import { parseSave } from '../src/engine/saves';
import { SHIP_CLASSES } from '../src/engine/definitions/ships';
describe('authority and determinism', () => {
  it('operator port only controls its own ship and snapshots are detached', () => {
    const e = quietEngine(),
      port = e.controllerPort('ops-verity');
    expect(port.getObservation()?.ship.id).toBe('verity');
    expect(port.dispatchCommand({ type: 'scan', shipId: 'vigil' }).ok).toBe(false);
    expect(port.dispatchCommand({ type: 'speed', speed: 16 }).ok).toBe(false);
    expect(port.dispatchCommand({ type: 'scan', shipId: 'verity' }).ok).toBe(true);
    const snap = e.snapshot();
    snap.ships[0].hull = 0;
    expect(e.state.ships[0].hull).toBeGreaterThan(0);
    expect(e.controllerPort('unknown').getObservation()).toBeNull();
  });
  it('configuration is immutable and worlds independent', () => {
    expect(Object.isFrozen(SHIP_CLASSES.galaxy.weapons)).toBe(true);
    const a = quietEngine(),
      b = quietEngine();
    a.state.ships[0].hull = 1;
    expect(b.state.ships[0].hull).toBe(110);
  });
  it('same seed and same command schedule produce identical worlds', () => {
    const a = new SimulationEngine(),
      b = new SimulationEngine();
    for (const e of [a, b]) {
      e.dispatchCommand({ type: 'createOrder', spec: spec('defense') });
      e.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
      e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
      run(e, 260);
    }
    expect(a.state).toEqual(b.state);
  });
  it('save resume matches an uninterrupted simulation including PRNG, AI, orders and intel', () => {
    const a = new SimulationEngine();
    a.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
    run(a, 70);
    const b = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(a.state))));
    run(a, 200);
    run(b, 200);
    expect(a.state).toEqual(b.state);
  });
  it('invalid orders are transactional and unsupported saves are rejected', () => {
    const e = quietEngine(),
      before = structuredClone(e.state);
    expect(
      e.dispatchCommand({ type: 'createOrder', spec: { ...spec('transport'), amount: -2 } }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    expect(() => parseSave({ ...e.state, version: 6 })).toThrow();
  });
});
