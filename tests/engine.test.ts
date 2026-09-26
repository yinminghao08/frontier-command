import { describe, expect, it } from 'vitest';
import { SimulationEngine, FIXED_DELTA } from '../src/engine/engine';
import { createWorld, BASE } from '../src/engine/data';
import { worldSchema } from '../src/engine/save-schema';
import type { Command, Contact } from '../src/engine/types';

const run = (e: SimulationEngine, seconds: number) => {
  e.state.paused = false;
  for (let i = 0; i < seconds * 10; i++) e.step();
};
const dispatch = (
  e: SimulationEngine,
  missionId: string,
  shipId: string,
  route: 'safe' | 'fast' = 'safe',
) => expect(e.dispatchCommand({ type: 'dispatch', missionId, shipId, route }).ok).toBe(true);
const contact = (faction: Contact['faction'] = 'klingon'): Contact => ({
  id: 'test-contact',
  faction,
  name: faction,
  x: BASE.x + 100,
  y: BASE.y,
  detected: true,
  identified: true,
  hostile: false,
  shield: 30,
  hull: 80,
  retreating: false,
  missionId: null,
  cooldown: 0,
  created: 0,
});

describe('world and command boundary', () => {
  it('starts with three distinct vessels and six valid missions', () => {
    const w = createWorld();
    expect(worldSchema.safeParse(w).success).toBe(true);
    expect(new Set(w.missions.map((m) => m.kind)).size).toBe(3);
    expect(new Set(w.ships.map((s) => s.capacity)).size).toBe(3);
  });
  it('does not advance while paused and requires fixed steps', () => {
    const e = new SimulationEngine();
    e.step();
    expect(e.state.time).toBe(0);
    expect(() => e.step(1)).toThrow();
    run(e, 1);
    expect(e.state.time).toBe(1);
  });
  it('rejects malformed, nonfinite, forged, cross-operator and missing IDs without mutation', () => {
    const e = new SimulationEngine();
    const before = structuredClone(e.state);
    for (const c of [
      { type: 'godmode' },
      { type: 'helm', shipId: 'verity', turn: NaN, throttle: 1 },
      { type: 'helm', shipId: 'verity', turn: 99, throttle: 0 },
      { type: 'dispatch', shipId: 'fake', missionId: 'amber', route: 'safe' },
      { type: 'pause', paused: false, resources: 999 },
    ])
      expect(e.dispatchCommand(c).ok).toBe(false);
    expect(e.dispatchCommand({ type: 'takeControl', shipId: 'verity' }, 'ops-verity').ok).toBe(
      false,
    );
    expect(e.dispatchCommand({ type: 'scan', shipId: 'vigil' }, 'ops-verity').ok).toBe(false);
    expect(e.state).toEqual(before);
  });
  it('rejects simultaneous assignments, insufficient cargo and supplies', () => {
    const e = new SimulationEngine();
    expect(
      e.dispatchCommand({
        type: 'dispatch',
        shipId: 'verity',
        missionId: 'outpost-run',
        route: 'safe',
      }).ok,
    ).toBe(false);
    dispatch(e, 'amber', 'verity');
    const before = structuredClone(e.state);
    expect(
      e.dispatchCommand({ type: 'dispatch', shipId: 'verity', missionId: 'echo', route: 'safe' })
        .ok,
    ).toBe(false);
    expect(
      e.dispatchCommand({ type: 'dispatch', shipId: 'meridian', missionId: 'amber', route: 'safe' })
        .ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    e.state.resources.supplies = 0;
    expect(
      e.dispatchCommand({
        type: 'dispatch',
        shipId: 'meridian',
        missionId: 'outpost-run',
        route: 'safe',
      }).ok,
    ).toBe(false);
  });
  it('hides unseen contacts from renderer and observation', () => {
    const e = new SimulationEngine();
    e.state.contacts.push({ ...contact('romulan'), detected: false });
    expect(e.snapshot().contacts).toHaveLength(0);
    expect(e.getObservation('ops-verity')?.contacts).toHaveLength(0);
    expect(e.getObservation('nobody')).toBeNull();
    expect(
      e.dispatchCommand({ type: 'target', shipId: 'verity', targetId: 'test-contact' }).ok,
    ).toBe(false);
  });
});

describe('mission loops', () => {
  it('completes all three directions together and does not settle rewards twice', () => {
    const e = new SimulationEngine();
    dispatch(e, 'amber', 'verity');
    dispatch(e, 'outpost-run', 'meridian');
    dispatch(e, 'k7', 'vigil');
    run(e, 310);
    for (const id of ['amber', 'outpost-run', 'k7'])
      expect(e.state.missions.find((m) => m.id === id)?.phase).toBe('complete');
    expect(e.state.resources.science).toBeGreaterThan(0);
    expect(e.state.resources.intel).toBeGreaterThan(0);
    expect(e.state.locations.find((l) => l.id === 'outpost')?.supply).toBe(65);
    const rewards = {
      science: e.state.resources.science,
      allocation: e.state.resources.allocation,
      intel: e.state.resources.intel,
    };
    run(e, 100);
    expect({
      science: e.state.resources.science,
      allocation: e.state.resources.allocation,
      intel: e.state.resources.intel,
    }).toEqual(rewards);
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  });
  it('offers genuine exploration risk/reward and science affects yield', () => {
    const play = (shipId: string, choice: 'remote' | 'close') => {
      const e = new SimulationEngine();
      dispatch(e, 'amber', shipId);
      run(e, 65);
      const m = e.state.missions[0];
      expect(m.phase).toBe('decision');
      expect(e.dispatchCommand({ type: 'investigate', shipId, choice }).ok).toBe(true);
      run(e, 140);
      return e;
    };
    const safe = play('verity', 'remote'),
      close = play('verity', 'close'),
      lowScience = play('meridian', 'remote');
    expect(close.state.resources.science).toBeGreaterThan(safe.state.resources.science);
    expect(close.state.ships[0].hull).toBeLessThan(safe.state.ships[0].hull);
    expect(safe.state.resources.science).toBeGreaterThan(lowScience.state.resources.science);
  });
  it('fast supply route saves time but causes damage, both deliver real cargo', () => {
    const play = (route: 'safe' | 'fast') => {
      const e = new SimulationEngine();
      dispatch(e, 'colony-run', 'meridian', route);
      e.state.paused = false;
      while (!e.state.missions[2].settled && e.state.time < 300) e.step();
      return e;
    };
    const safe = play('safe'),
      fast = play('fast');
    expect(fast.state.time).toBeLessThan(safe.state.time);
    expect(fast.state.ships[1].hull).toBeLessThan(safe.state.ships[1].hull);
    expect(fast.state.ships[1].cargo).toBe(0);
    expect(safe.state.locations[1].supply).toBe(50);
  });
  it('route changes are possible before arrival and invalid after settlement', () => {
    const e = new SimulationEngine();
    dispatch(e, 'colony-run', 'meridian');
    run(e, 10);
    expect(e.dispatchCommand({ type: 'route', shipId: 'meridian', route: 'fast' }).ok).toBe(true);
    run(e, 150);
    expect(e.dispatchCommand({ type: 'route', shipId: 'meridian', route: 'safe' }).ok).toBe(false);
  });
  it('deadline continues while holding and recall returns cargo without granting a reward', () => {
    const e = new SimulationEngine();
    dispatch(e, 'colony-run', 'meridian');
    run(e, 10);
    e.dispatchCommand({ type: 'hold', shipId: 'meridian' });
    run(e, 241);
    expect(e.state.missions[2].phase).toBe('failed');
    expect(e.state.resources.allocation).toBe(115);
    run(e, 20);
    expect(e.state.ships[1].status).toBe('docked');
    expect(e.state.resources.supplies).toBe(185);
    const e2 = new SimulationEngine();
    dispatch(e2, 'outpost-run', 'meridian');
    run(e2, 10);
    e2.dispatchCommand({ type: 'recall', shipId: 'meridian' });
    run(e2, 20);
    expect(e2.state.resources.supplies).toBe(140);
    expect(e2.state.missions[3].result).toContain('召回');
  });
  it('Romulan identification and warning can resolve a patrol without firing', () => {
    const e = new SimulationEngine();
    dispatch(e, 'r3', 'vigil');
    run(e, 330);
    expect(e.state.missions[5].phase).toBe('complete');
    expect(e.state.missions[5].result).toContain('警告');
    expect(e.state.ships[2].hull).toBe(100);
  });
  it('finished task can be reopened only after vessel returns', () => {
    const e = new SimulationEngine();
    dispatch(e, 'amber', 'verity');
    run(e, 130);
    expect(e.dispatchCommand({ type: 'renew', missionId: 'amber' }).ok).toBe(false);
    run(e, 100);
    expect(e.dispatchCommand({ type: 'renew', missionId: 'amber' }).ok).toBe(true);
    dispatch(e, 'amber', 'verity');
    run(e, 230);
    expect(e.state.missions[0].run).toBe(1);
    expect(e.state.resources.science).toBeGreaterThan(60);
  });
});

describe('tactical control', () => {
  it('manual control is exclusive, 1x, and other ships continue moving', () => {
    const e = new SimulationEngine();
    dispatch(e, 'amber', 'verity');
    dispatch(e, 'colony-run', 'meridian');
    e.dispatchCommand({ type: 'speed', speed: 4 });
    expect(e.dispatchCommand({ type: 'takeControl', shipId: 'verity' }).ok).toBe(true);
    expect(e.state.speed).toBe(1);
    expect(e.dispatchCommand({ type: 'speed', speed: 4 }).ok).toBe(false);
    expect(e.dispatchCommand({ type: 'takeControl', shipId: 'vigil' }).ok).toBe(false);
    const start = structuredClone(e.state.ships);
    run(e, 10);
    expect(e.state.ships[0].x).toBe(start[0].x);
    expect(e.state.ships[1].y).not.toBe(start[1].y);
    e.dispatchCommand({ type: 'helm', shipId: 'verity', turn: 1, throttle: 1 });
    run(e, 2);
    expect(e.state.ships[0].x).not.toBe(start[0].x);
    e.clearInputs();
    expect(e.state.ships[0].helm.turn).toBe(0);
    e.dispatchCommand({ type: 'releaseControl', shipId: 'verity', resume: true });
    run(e, 220);
    expect(e.state.missions[0].phase).toBe('complete');
  });
  it('firing validates identification, arc, range and cooldown, then applies shield damage', () => {
    const e = new SimulationEngine();
    const s = e.state.ships[2];
    e.state.contacts.push(contact());
    s.heading = 0;
    s.y = BASE.y;
    s.targetId = 'test-contact';
    s.status = 'holding';
    e.state.paused = false;
    e.state.contacts[0].identified = false;
    expect(e.dispatchCommand({ type: 'fire', shipId: s.id }).ok).toBe(false);
    e.state.contacts[0].identified = true;
    s.heading = Math.PI;
    expect(e.dispatchCommand({ type: 'fire', shipId: s.id }).ok).toBe(false);
    s.heading = 0;
    e.state.contacts[0].x = 1100;
    expect(e.dispatchCommand({ type: 'fire', shipId: s.id }).ok).toBe(false);
    e.state.contacts[0].x = BASE.x + 100;
    expect(e.dispatchCommand({ type: 'fire', shipId: s.id }).ok).toBe(true);
    expect(e.state.contacts[0].shield).toBe(12);
    expect(e.state.contacts[0].hull).toBe(80);
    expect(e.dispatchCommand({ type: 'fire', shipId: s.id }).ok).toBe(false);
  });
  it('Klingon warnings depend on deterrence and enemies cause actual damage', () => {
    const e = new SimulationEngine();
    const t = contact();
    e.state.contacts.push(t);
    e.state.ships[0].status = 'holding';
    e.state.ships[0].shield = 0;
    expect(e.dispatchCommand({ type: 'hail', shipId: 'verity', targetId: t.id }).ok).toBe(true);
    expect(t.hostile).toBe(true);
    run(e, 1);
    expect(e.state.ships[0].hull).toBeLessThan(100);
    expect(e.dispatchCommand({ type: 'hail', shipId: 'vigil', targetId: t.id }).ok).toBe(true);
    expect(t.retreating).toBe(true);
  });
  it('pause prevents firing and high-level orders release manual helm', () => {
    const e = new SimulationEngine();
    dispatch(e, 'amber', 'verity');
    e.dispatchCommand({ type: 'takeControl', shipId: 'verity' });
    e.dispatchCommand({ type: 'helm', shipId: 'verity', turn: 1, throttle: 1 });
    e.dispatchCommand({ type: 'pause', paused: true });
    expect(e.state.ships[0].helm).toEqual({ turn: 0, throttle: 0 });
    expect(e.dispatchCommand({ type: 'fire', shipId: 'verity' }).ok).toBe(false);
    e.dispatchCommand({ type: 'hold', shipId: 'verity' });
    expect(e.state.manualShipId).toBeNull();
    expect(e.dispatchCommand({ type: 'resume', shipId: 'verity' }).ok).toBe(true);
    run(e, 220);
    expect(e.state.missions[0].phase).toBe('complete');
  });
  it('operator commands cannot override a direct commander takeover', () => {
    const e = new SimulationEngine();
    dispatch(e, 'amber', 'verity');
    e.dispatchCommand({ type: 'takeControl', shipId: 'verity' });
    expect(e.dispatchCommand({ type: 'recall', shipId: 'verity' }, 'ops-verity').ok).toBe(false);
    expect(e.getObservation('ops-verity')?.legalActions).toEqual([]);
  });
  it('disabled ships tow home and free slow repair prevents a resource deadlock', () => {
    const e = new SimulationEngine();
    const s = e.state.ships[0];
    s.status = 'holding';
    s.hull = 1;
    s.shield = 0;
    e.state.resources.materials = 0;
    e.state.contacts.push({ ...contact(), hostile: true });
    run(e, 1);
    expect(s.status).toBe('disabled');
    expect(e.dispatchCommand({ type: 'takeControl', shipId: s.id }).ok).toBe(false);
    run(e, 36);
    expect(s.status).toBe('docked');
    expect(s.hull).toBe(1);
    expect(e.dispatchCommand({ type: 'repair', shipId: s.id }).ok).toBe(true);
    expect(s.emergency).toBe(true);
    run(e, 210);
    expect(s.status).toBe('docked');
    expect(s.hull).toBe(100);
  });
});

describe('determinism and persistence contract', () => {
  it('same initial seed and timed commands yield identical complete state', () => {
    const play = () => {
      const e = new SimulationEngine();
      dispatch(e, 'colony-run', 'meridian', 'fast');
      dispatch(e, 'r3', 'vigil');
      run(e, 90);
      e.dispatchCommand({ type: 'takeControl', shipId: 'verity' });
      e.dispatchCommand({ type: 'helm', shipId: 'verity', turn: 0.3, throttle: 1 });
      run(e, 10);
      e.dispatchCommand({ type: 'releaseControl', shipId: 'verity', resume: false });
      run(e, 500);
      return e.state;
    };
    expect(play()).toEqual(play());
  });
  it('restored snapshots continue identically including PRNG state', () => {
    const e = new SimulationEngine();
    dispatch(e, 'colony-run', 'meridian', 'fast');
    run(e, 20);
    const restored = new SimulationEngine(worldSchema.parse(JSON.parse(JSON.stringify(e.state))));
    run(e, 400);
    run(restored, 400);
    expect(restored.state).toEqual(e.state);
  });
  it('rejects wrong versions and broken references in a save', () => {
    const w = createWorld();
    expect(worldSchema.safeParse({ ...w, version: 9 }).success).toBe(false);
    w.ships[0].missionId = 'missing';
    expect(worldSchema.safeParse(w).success).toBe(false);
  });
  it('bounds contacts, logs and trails during a long run', () => {
    const e = new SimulationEngine();
    run(e, 7200);
    expect(e.state.contacts.filter((c) => !c.retreating).length).toBeLessThanOrEqual(4);
    expect(e.state.contacts.length).toBeLessThanOrEqual(20);
    expect(e.state.logs.length).toBeLessThanOrEqual(180);
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  });
});
