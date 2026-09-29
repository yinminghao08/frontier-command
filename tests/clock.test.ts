import { describe, it, expect } from 'vitest';
import { quietEngine, run, spec, until } from './helpers';
import { gameCalendar, FIXED_DELTA } from '../src/engine/clock';
describe('Step 1 clock retained', () => {
  it.each([1, 4, 16] as const)('%sx changes step count only', (speed) => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'speed', speed });
    e.dispatchCommand({ type: 'pause', paused: false });
    e.advanceFrame();
    expect(e.state.tick).toBe(speed);
    expect(e.state.time).toBe(speed / 10);
  });
  it('freezes all simulation when paused', () => {
    const e = quietEngine(),
      before = structuredClone(e.state);
    e.advanceFrame();
    e.step();
    expect(e.state).toEqual(before);
  });
  it('rejects variable deltas', () => {
    expect(() => quietEngine().step(0.5)).toThrow();
    expect(FIXED_DELTA).toBe(0.1);
  });
  it('calendar and midnight event cross once', () => {
    const e = quietEngine();
    e.state.tick = 14399;
    e.state.time = 1439.9;
    e.state.paused = false;
    expect(e.step().filter((e) => e.type === 'dayBoundary')).toHaveLength(1);
    expect(e.step().filter((e) => e.type === 'dayBoundary')).toHaveLength(0);
    expect(gameCalendar(14400)).toEqual({ day: 2, hour: 0, minute: 0 });
  });
  it('decision pauses atomically and remaining accelerated batch does not run', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
    until(e, () => e.state.orders[0].phase === 'decision');
    expect(e.state.paused).toBe(true);
    const tick = e.state.tick;
    e.advanceFrame();
    expect(e.state.tick).toBe(tick);
    expect(e.state.pauseReasons.some((r) => r.kind === 'investigation')).toBe(true);
  });
  it('unhandled investigation follows the preselected policy after 20 resumed minutes', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: { ...spec('explore'), approach: 'close' } });
    until(e, () => e.state.orders[0].phase === 'decision');
    run(e, 21);
    expect(e.state.orders[0].phase).toBe('working');
    expect(e.state.orders[0].approach).toBe('close');
  });
});
