import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/engine/engine';
import { TICKS_PER_DAY, gameCalendar } from '../src/engine/clock';
import { createWorld } from '../src/engine/data';
import { parseSave } from '../src/engine/saves';
import { worldSchema } from '../src/engine/save-schema';
import { time } from '../src/ui/format';
import type { Contact, SimulationEvent } from '../src/engine/types';

const resume = (e: SimulationEngine) => e.dispatchCommand({ type: 'pause', paused: false });
const contact = (e: SimulationEngine, overrides: Partial<Contact> = {}): Contact => ({
  id: 'test',
  faction: 'klingon',
  name: 'Test contact',
  x: e.state.ships[0].x + 50,
  y: e.state.ships[0].y,
  detected: false,
  identified: false,
  hostile: false,
  shield: 65,
  hull: 80,
  retreating: false,
  missionId: null,
  cooldown: 0,
  created: e.state.time,
  ...overrides,
});
const exploring = () => {
  const e = new SimulationEngine();
  e.dispatchCommand({ type: 'dispatch', shipId: 'verity', missionId: 'amber', route: 'safe' });
  const loc = e.state.locations.find((l) => l.id === 'anomaly1')!;
  Object.assign(e.state.ships[0], { x: loc.x, y: loc.y, path: [] });
  resume(e);
  return e;
};

describe('persistent game clock', () => {
  it.each([1, 4, 16] as const)('advances exactly at %ix per nominal real second', (speed) => {
    const e = new SimulationEngine();
    expect(time(e.state.time)).toBe('Day 1 00:00');
    e.dispatchCommand({ type: 'speed', speed });
    expect(e.advanceFrame()).toEqual([]);
    expect(e.state.tick).toBe(0);
    resume(e);
    for (let frame = 0; frame < 10; frame++) e.advanceFrame();
    expect(e.state.tick).toBe(speed * 10);
    expect(e.state.time).toBe(speed);
  });
  it('preserves fractional minutes through speed changes and paused pulses', () => {
    const e = new SimulationEngine();
    resume(e);
    e.advanceFrame();
    expect(e.state.time).toBe(0.1);
    e.dispatchCommand({ type: 'speed', speed: 4 });
    e.advanceFrame();
    expect(e.state.time).toBe(0.5);
    e.dispatchCommand({ type: 'pause', paused: true });
    e.dispatchCommand({ type: 'speed', speed: 16 });
    const frozen = structuredClone(e.state);
    for (let i = 0; i < 100; i++) e.advanceFrame();
    expect(e.state).toEqual(frozen);
    resume(e);
    e.advanceFrame();
    expect(e.state.time).toBe(2.1);
    const before = structuredClone(e.state);
    for (const speed of [0, 2, 8, -1, NaN, Infinity, '16'])
      expect(e.dispatchCommand({ type: 'speed', speed }).ok).toBe(false);
    expect(e.state).toEqual(before);
    expect(() => e.step(1)).toThrow('fixed');
  });
  it('keeps manual control at 1x and rejects accelerated speeds', () => {
    const e = new SimulationEngine();
    e.dispatchCommand({ type: 'speed', speed: 16 });
    e.dispatchCommand({ type: 'takeControl', shipId: 'verity' });
    expect(e.state.speed).toBe(1);
    for (const speed of [4, 16]) expect(e.dispatchCommand({ type: 'speed', speed }).ok).toBe(false);
  });
  it('formats hour and day boundaries from integer ticks', () => {
    expect(gameCalendar(599)).toEqual({ day: 1, hour: 0, minute: 59 });
    expect(time(60)).toBe('Day 1 01:00');
    expect(time(1439.9)).toBe('Day 1 23:59');
    expect(time(1440)).toBe('Day 2 00:00');
    expect(time(1440 * 99)).toBe('Day 100 00:00');
  });
  it('emits each midnight exactly once across accelerated frames and restart', () => {
    const e = new SimulationEngine();
    e.state.tick = TICKS_PER_DAY - 1;
    e.state.time = e.state.tick / 10;
    // Isolate the calendar from encounter scheduling in this test.
    e.state.nextIncursion = 1e9;
    expect(e.step()).toEqual([]);
    resume(e);
    const boundary = { type: 'dayBoundary', day: 2, tick: TICKS_PER_DAY, time: 1440 };
    expect(e.step()).toEqual([boundary]);
    e.dispatchCommand({ type: 'pause', paused: true });
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    expect(restored.advanceFrame()).toEqual([]);
    expect(restored.state.tick).toBe(TICKS_PER_DAY);
    resume(restored);
    restored.dispatchCommand({ type: 'speed', speed: 16 });
    const events: SimulationEvent[] = [];
    for (let i = 0; i < 1800; i++) events.push(...restored.advanceFrame());
    expect(events).toEqual([
      { type: 'dayBoundary', day: 3, tick: 28800, time: 2880 },
      { type: 'dayBoundary', day: 4, tick: 43200, time: 4320 },
    ]);
    expect(restored.state.logs.length).toBeLessThanOrEqual(180);
  });
  it('keeps every gameplay system frozen while paused', () => {
    const e = new SimulationEngine();
    e.dispatchCommand({
      type: 'dispatch',
      shipId: 'verity',
      missionId: 'colony-run',
      route: 'fast',
    });
    Object.assign(e.state.ships[0], { cooldown: 3, helm: { turn: 1, throttle: 1 } });
    Object.assign(e.state.ships[1], { status: 'repairing', repair: 20 });
    Object.assign(e.state.ships[2], { status: 'disabled', tow: 35 });
    e.state.contacts.push(contact(e, { hostile: true, cooldown: 4 }));
    e.state.beams.push({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, enemy: false, expires: 0.1 });
    e.state.nextIncursion = 0;
    e.state.tick = 1799;
    e.state.time = 179.9;
    e.dispatchCommand({ type: 'speed', speed: 16 });
    const before = structuredClone(e.state);
    for (let i = 0; i < 100; i++) {
      expect(e.step()).toEqual([]);
      expect(e.advanceFrame()).toEqual([]);
    }
    expect(e.state).toEqual(before);
  });
  it('matches accelerated frames with identical seeded fixed steps and commands', () => {
    const a = new SimulationEngine();
    a.dispatchCommand({
      type: 'dispatch',
      shipId: 'meridian',
      missionId: 'colony-run',
      route: 'fast',
    });
    a.dispatchCommand({ type: 'dispatch', shipId: 'vigil', missionId: 'r3', route: 'safe' });
    a.dispatchCommand({ type: 'speed', speed: 16 });
    const b = new SimulationEngine(a.state);
    for (let frame = 0; frame < 400; frame++) {
      if (a.state.paused) {
        resume(a);
        resume(b);
      }
      const accelerated = a.advanceFrame();
      const fixed: SimulationEvent[] = [];
      for (let i = 0; i < 16 && !b.state.paused; i++) fixed.push(...b.step());
      expect(accelerated).toEqual(fixed);
    }
    expect(a.state).toEqual(b.state);
    expect(a.state.seed).not.toBe(a.state.initialSeed);
  });
});

describe('critical transition pauses', () => {
  it('stops a 16x batch at a decision and requires explicit resume after choosing', () => {
    const e = exploring();
    e.dispatchCommand({ type: 'speed', speed: 16 });
    e.state.ships[0].helm = { turn: 1, throttle: 1 };
    expect(e.advanceFrame()[0].type).toBe('criticalPause');
    expect(e.state.tick).toBe(1);
    expect(e.state.paused).toBe(true);
    expect(e.state.pauseReasons.map((r) => r.kind)).toEqual(['investigation']);
    expect(e.state.ships[0].helm).toEqual({ turn: 0, throttle: 0 });
    expect(e.dispatchCommand({ type: 'investigate', shipId: 'verity', choice: 'remote' }).ok).toBe(
      true,
    );
    expect(e.state.paused).toBe(true);
    expect(e.state.pauseReasons).toHaveLength(1);
    e.advanceFrame();
    expect(e.state.tick).toBe(1);
    resume(e);
    expect(e.state.pauseReasons).toEqual([]);
    e.advanceFrame();
    expect(e.state.tick).toBe(17);
  });
  it('uses 20 unpaused game minutes for the investigation fallback', () => {
    const e = exploring();
    e.step();
    for (let i = 0; i < 500; i++) e.advanceFrame();
    expect(e.state.missions[0].choice).toBeNull();
    resume(e);
    for (let i = 0; i < 199; i++) e.step();
    expect(e.state.missions[0].choice).toBeNull();
    e.step();
    expect(e.state.missions[0].choice).toBe('remote');
  });
  it('pauses on passive detection only once', () => {
    const e = new SimulationEngine();
    e.state.ships[0].status = 'holding';
    e.state.contacts.push(contact(e));
    resume(e);
    e.advanceFrame();
    expect(e.state.pauseReasons.map((r) => r.kind)).toEqual(['contactDetected']);
    resume(e);
    e.advanceFrame();
    expect(e.state.paused).toBe(false);
  });
  it('pauses on active scanning and collects multiple simultaneous contacts', () => {
    const e = new SimulationEngine();
    e.state.contacts.push(contact(e), contact(e, { id: 'second' }));
    resume(e);
    expect(e.dispatchCommand({ type: 'scan', shipId: 'verity' }).ok).toBe(true);
    expect(e.state.pauseReasons.map((r) => r.entityId)).toEqual(['test', 'second']);
    expect(e.state.contacts.every((c) => c.identified)).toBe(true);
    resume(e);
    e.dispatchCommand({ type: 'scan', shipId: 'verity' });
    expect(e.state.paused).toBe(false);
  });
  it('pauses when a patrol creates an already visible contact', () => {
    const e = new SimulationEngine();
    e.dispatchCommand({ type: 'dispatch', shipId: 'vigil', missionId: 'k7', route: 'safe' });
    const loc = e.state.locations.find((l) => l.id === 'border1')!;
    Object.assign(e.state.ships[2], { x: loc.x, y: loc.y, path: [] });
    resume(e);
    e.step();
    expect(e.state.pauseReasons.map((r) => r.kind)).toEqual(['contactDetected']);
  });
  it.each(['hail', 'fire'] as const)(
    'pauses on new hostilities from %s, without repeatedly pausing',
    (type) => {
      const e = new SimulationEngine();
      const s = e.state.ships[0];
      s.status = 'holding';
      s.heading = 0;
      s.targetId = 'test';
      e.state.contacts.push(contact(e, { detected: true, identified: true }));
      resume(e);
      expect(
        e.dispatchCommand(
          type === 'hail' ? { type, shipId: s.id, targetId: 'test' } : { type, shipId: s.id },
        ).ok,
      ).toBe(true);
      expect(e.state.pauseReasons.map((r) => r.kind)).toEqual(['hostility']);
      resume(e);
      e.step();
      expect(e.state.paused).toBe(false);
    },
  );
  it('collects low hull, disablement and mission failure in one atomic tick', () => {
    const e = new SimulationEngine();
    e.dispatchCommand({ type: 'dispatch', shipId: 'verity', missionId: 'amber', route: 'safe' });
    const s = e.state.ships[0];
    s.hull = 30;
    s.shield = 0;
    s.path = [];
    for (let i = 0; i < 4; i++)
      e.state.contacts.push(
        contact(e, { id: String(i), detected: true, identified: true, hostile: true }),
      );
    resume(e);
    e.dispatchCommand({ type: 'speed', speed: 16 });
    e.advanceFrame();
    expect(e.state.tick).toBe(1);
    expect(e.state.pauseReasons.map((r) => r.kind)).toEqual([
      'lowHull',
      'missionFailed',
      'disabled',
    ]);
    expect(s.status).toBe('disabled');
    expect(worldSchema.safeParse(e.state).success).toBe(true);
    resume(e);
    e.step();
    expect(e.state.paused).toBe(false);
  });
  it('pauses on a deadline failure and does not pause again for that failed mission', () => {
    const e = new SimulationEngine();
    e.dispatchCommand({
      type: 'dispatch',
      shipId: 'verity',
      missionId: 'colony-run',
      route: 'safe',
    });
    e.dispatchCommand({ type: 'hold', shipId: 'verity' });
    e.state.missions[2].deadline = 0.05;
    resume(e);
    e.step();
    expect(e.state.pauseReasons.map((r) => r.kind)).toEqual(['missionFailed']);
    resume(e);
    e.step();
    expect(e.state.paused).toBe(false);
  });
  it('emits midnight and critical pause together without replay on resume or reload', () => {
    const e = exploring();
    e.state.tick = TICKS_PER_DAY - 1;
    e.state.time = e.state.tick / 10;
    e.state.nextIncursion = 1e9;
    const events = e.advanceFrame();
    expect(events.map((event) => event.type)).toEqual(['dayBoundary', 'criticalPause']);
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    expect(restored.state.pauseReasons).toEqual(e.state.pauseReasons);
    expect(restored.step()).toEqual([]);
    resume(restored);
    expect(restored.step()).toEqual([]);
  });
  it('does not interpret warning logs as critical events', () => {
    const e = new SimulationEngine();
    resume(e);
    e.log('routine warning', 'warning');
    e.log('diagnostic', 'danger');
    e.step();
    expect(e.state.paused).toBe(false);
  });
});
