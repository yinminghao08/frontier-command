import { describe, it, expect } from 'vitest';
import { quietEngine, run, spec, until } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { makeEnemy, makeShip } from '../src/engine/data';
import { WEAPONS } from '../src/engine/definitions/ships';
import { attack, permittedTarget, regenerate, shouldRetreat } from '../src/engine/combat';
import { decideThreat } from '../src/engine/threats';
import { observe, updateSensors, visibleIntel } from '../src/engine/sensors';
import { planRoute, dist } from '../src/engine/navigation';
import type { ROE } from '../src/engine/types';
describe('general orders and closed loops', () => {
  it('the default live world demo completes all three operations including defense recovery after chasing a raider', () => {
    const e = new SimulationEngine();
    for (const kind of ['transport', 'defense', 'explore'] as const)
      e.dispatchCommand({ type: 'createOrder', spec: spec(kind) });
    until(e, () => e.state.orders.every((o) => o.phase === 'complete'));
    expect(e.state.orders.map((o) => o.outcome)).toEqual(['success', 'success', 'success']);
    expect(e.state.locations.find((l) => l.id === 'colony')!.hull).toBeGreaterThan(0);
  });
  it('runs three genuinely different orders in parallel and settles exactly once after return', () => {
    const e = quietEngine();
    for (const kind of ['transport', 'explore', 'defense'] as const)
      expect(e.dispatchCommand({ type: 'createOrder', spec: spec(kind) }).ok).toBe(true);
    const base = e.state.locations.find((l) => l.id === 'base')!,
      colony = e.state.locations.find((l) => l.id === 'colony')!;
    expect(base.reserved.supplies).toBe(30);
    until(e, () => e.state.orders.every((o) => o.phase === 'complete'));
    expect(e.state.orders.every((o) => o.outcome === 'success')).toBe(true);
    expect(e.state.ships.every((s) => s.orderId === null && s.status === 'docked')).toBe(true);
    expect(colony.stock.supplies).toBeGreaterThan(30);
    expect(e.state.resources.science).toBeGreaterThan(0);
    expect(e.state.resources.intel).toBeGreaterThan(0);
    expect(e.state.resources.allocation).toBe(65);
    expect(base.reserved.supplies).toBe(0);
    const resources = structuredClone(e.state.resources);
    run(e, 30);
    expect(e.state.resources).toEqual(resources);
  });
  it('rejects duplicate assignments, capacity overflow, inventory overdraft and forged parameters without mutation', () => {
    const e = quietEngine();
    for (const s of [
      { ...spec('transport', 'vigil'), amount: 60 },
      { ...spec('transport'), amount: 100, cargoKind: 'medical' as const },
      { ...spec('defense'), shipIds: ['vigil', 'vigil'] },
    ]) {
      if (s.cargoKind === 'medical') s.amount = 101;
      const before = structuredClone(e.state);
      expect(e.dispatchCommand({ type: 'createOrder', spec: s }).ok).toBe(false);
      expect(e.state).toEqual(before);
    }
    expect(e.dispatchCommand({ type: 'createOrder', spec: spec('transport') }).ok).toBe(true);
    const before = structuredClone(e.state);
    expect(e.dispatchCommand({ type: 'createOrder', spec: spec('transport') }).ok).toBe(false);
    expect(e.state).toEqual(before);
    expect(
      e.dispatchCommand({ type: 'createOrder', spec: { ...spec('defense'), reward: 10000 } }).ok,
    ).toBe(false);
  });
  it('loads real cargo at a non-base origin and transfers it exactly once', () => {
    const e = quietEngine(),
      src = e.state.locations.find((l) => l.id === 'depot')!,
      dest = e.state.locations.find((l) => l.id === 'outpost')!;
    expect(
      e.dispatchCommand({
        type: 'createOrder',
        spec: {
          ...spec('transport'),
          sourceId: src.id,
          objective: { type: 'location', id: dest.id },
          amount: 45,
        },
      }).ok,
    ).toBe(true);
    until(e, () => e.state.orders[0].delivered);
    expect(src.stock.supplies).toBe(35);
    expect(dest.stock.supplies).toBe(65);
    expect(e.state.ships.find((s) => s.id === 'meridian')!.cargo.supplies).toBe(0);
    until(e, () => e.state.orders[0].phase === 'complete');
    expect(dest.stock.supplies).toBe(65);
  });
  it('cancellation releases reservations and returns loaded cargo', () => {
    const e = quietEngine(),
      s = spec('transport');
    e.dispatchCommand({ type: 'createOrder', spec: s });
    e.dispatchCommand({ type: 'cancelOrder', orderId: 'order-1' });
    expect(e.state.locations.find((l) => l.id === 'base')!.reserved.supplies).toBe(0);
    until(e, () => e.state.orders[0].phase === 'complete');
    e.dispatchCommand({ type: 'createOrder', spec: s });
    until(e, () => e.state.orders[1].loaded);
    expect(e.state.ships.find((s) => s.id === 'meridian')!.cargo.supplies).toBe(30);
    e.dispatchCommand({ type: 'cancelOrder', orderId: 'order-2' });
    until(e, () => e.state.orders[1].phase === 'complete');
    expect(e.state.locations.find((l) => l.id === 'base')!.stock.supplies).toBe(240);
    expect(e.state.resources.allocation).toBe(0);
  });
  it('pirate theft removes cargo and destruction permanently archives the remainder', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
    until(e, () => e.state.orders[0].loaded);
    const s = e.state.ships.find((s) => s.id === 'meridian')!;
    s.shield = 0;
    s.hull = 45;
    const pirate = makeEnemy('robber', 'raider', 'pirate', { x: s.x + 35, y: s.y });
    pirate.nextDecision = 1e6;
    pirate.targetId = s.id;
    pirate.knownTargets = [{ id: s.id, x: s.x, y: s.y, seenAt: e.state.time, score: 100 }];
    e.state.enemies = [pirate];
    e.state.seed = 1;
    run(e, 0.1);
    expect(pirate.loot).toBe(20);
    expect(s.cargo.supplies).toBe(10);
    expect(pirate.cargo.supplies).toBe(20);
    expect(s.hull).toBe(0);
    expect(e.state.ships.some((x) => x.id === s.id)).toBe(false);
    expect(e.state.losses[0].cargo.supplies).toBe(10);
    e.state.enemies = [];
    until(e, () => e.state.orders[0].phase === 'complete');
    expect(e.state.ships.some((x) => x.id === s.id)).toBe(false);
    expect(e.state.losses).toHaveLength(1);
    expect(s.hull).toBe(0);
    expect(e.state.orders[0].outcome).toBe('failed');
  });
  it('a missed deadline returns cargo without delivery or reward', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
    until(e, () => e.state.orders[0].loaded);
    e.state.orders[0].deadline = e.state.time + 0.1;
    run(e, 1);
    expect(e.state.orders[0].outcome).toBe('failed');
    until(e, () => e.state.orders[0].phase === 'complete');
    expect(e.state.resources.allocation).toBe(0);
    expect(e.state.locations.find((l) => l.id === 'base')!.stock.supplies).toBe(240);
  });
  it('transported materials require a separate consuming repair command', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'colony')!;
    l.hull = 60;
    e.dispatchCommand({
      type: 'createOrder',
      spec: { ...spec('transport'), cargoKind: 'materials', amount: 30 },
    });
    until(e, () => e.state.orders[0].delivered);
    expect(l.hull).toBe(60);
    expect(l.stock.materials).toBe(50);
    expect(e.dispatchCommand({ type: 'repairFacility', locationId: l.id }).ok).toBe(true);
    expect(l.hull).toBe(160);
    expect(l.stock.materials).toBe(0);
  });
  it('near investigation has actual damage, longer work and greater science than remote', () => {
    const results = ['remote', 'close'].map((approach) => {
      const e = quietEngine();
      e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
      until(e, () => e.state.orders[0].phase === 'decision');
      e.state.ships.find((s) => s.id === 'verity')!.shield = 0;
      e.dispatchCommand({ type: 'investigate', orderId: 'order-1', approach });
      until(e, () => e.state.orders[0].phase === 'complete');
      return {
        science: e.state.resources.science,
        hull: e.state.ships.find((s) => s.id === 'verity')!.hull,
        time: e.state.time,
        work: e.state.orders[0].work,
      };
    });
    expect(results[1].science).toBeGreaterThan(results[0].science);
    expect(results[1].hull).toBeLessThan(results[0].hull);
    expect(results[1].work).toBeGreaterThan(results[0].work);
  });
  it('does not farm an unchanged survey and allows unknown coordinate exploration', () => {
    const e = quietEngine();
    for (let i = 0; i < 2; i++) {
      e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
      until(e, () => e.state.orders[i].phase === 'complete');
    }
    expect(e.state.orders[0].rewarded).toBe(true);
    expect(e.state.orders[1].rewarded).toBe(false);
    expect(
      e.dispatchCommand({
        type: 'createOrder',
        spec: { ...spec('explore'), objective: { type: 'point', x: 700, y: 180 } },
      }).ok,
    ).toBe(true);
  });
  it('enforces cross-border authorization on creation and policy changes', () => {
    const e = quietEngine(),
      s = { ...spec('explore'), objective: { type: 'point' as const, x: 1150, y: 250 } };
    expect(e.dispatchCommand({ type: 'createOrder', spec: s }).ok).toBe(false);
    expect(e.dispatchCommand({ type: 'createOrder', spec: { ...s, border: 'neutral' } }).ok).toBe(
      true,
    );
    until(e, () => e.state.ships.find((s) => s.id === 'verity')!.x > 1040);
    expect(
      e.dispatchCommand({
        type: 'updateOrder',
        orderId: 'order-1',
        changes: { border: 'federation' },
      }).ok,
    ).toBe(false);
    e.dispatchCommand({ type: 'cancelOrder', orderId: 'order-1' });
    until(e, () => e.state.orders[0].phase === 'complete');
  });
  it('holds, resumes, reroutes and withdraws without rewarding failure', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
    run(e, 5);
    e.dispatchCommand({ type: 'holdOrder', orderId: 'order-1' });
    const p = { ...e.state.ships[0] };
    run(e, 5);
    expect(e.state.ships[0].x).toBe(p.x);
    e.dispatchCommand({ type: 'resumeOrder', orderId: 'order-1' });
    expect(
      e.dispatchCommand({ type: 'updateOrder', orderId: 'order-1', changes: { route: 'fast' } }).ok,
    ).toBe(true);
    e.state.ships[0].hull = 20;
    run(e, 1);
    expect(e.state.orders[0].outcome).toBe('failed');
    until(e, () => e.state.orders[0].phase === 'complete');
    expect(e.state.resources.allocation).toBe(0);
  });
  it('can add and release defense ships while keeping returning ships occupied', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('defense') });
    run(e, 5);
    expect(
      e.dispatchCommand({
        type: 'updateOrder',
        orderId: 'order-1',
        changes: { shipIds: ['vigil', 'horizon'] },
      }).ok,
    ).toBe(true);
    expect(
      e.dispatchCommand({
        type: 'updateOrder',
        orderId: 'order-1',
        changes: { shipIds: ['horizon'] },
      }).ok,
    ).toBe(true);
    expect(e.state.ships.find((s) => s.id === 'vigil')!.status).toBe('returning');
    until(e, () => e.state.orders[0].phase === 'complete');
  });
  it('fails an unconfirmed interception when contact is lost instead of awarding a kill', () => {
    const e = quietEngine(),
      enemy = makeEnemy('lost', 'scout', 'romulan', { x: 1000, y: 500 });
    observe(e.state, enemy, 10);
    e.dispatchCommand({
      type: 'createOrder',
      spec: { ...spec('defense'), objective: { type: 'contact', id: 'lost' } },
    });
    run(e, 35);
    expect(e.state.orders[0].outcome).toBe('failed');
    expect(e.state.resources.allocation).toBe(0);
  });
  it('rejects free repair and transfers only reserved real torpedoes', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'horizon')!,
      base = e.state.locations.find((l) => l.id === 'base')!;
    s.hull = 1;
    s.photon = 0;
    s.quantum = 0;
    base.stock.materials = 0;
    expect(e.dispatchCommand({ type: 'repair', shipId: s.id }).ok).toBe(false);
    const before = e.state.armory.stock.photon;
    expect(
      e.dispatchCommand({ type: 'rearm', shipId: s.id, load: { photon: 3, quantum: 2 } }).ok,
    ).toBe(true);
    expect(e.state.armory.reserved).toEqual({ photon: 3, quantum: 2 });
    run(e, 1);
    expect(s.photon).toBe(1);
    expect(s.quantum).toBe(0);
    run(e, 5);
    expect(s.photon).toBe(3);
    expect(s.quantum).toBe(2);
    expect(e.state.armory.stock.photon).toBe(before - 3);
    expect(e.state.armory.reserved).toEqual({ photon: 0, quantum: 0 });
    expect(base.stock.materials).toBe(0);
    e.state.armory.stock.photon = 0;
    expect(
      e.dispatchCommand({ type: 'rearm', shipId: s.id, load: { photon: 1, quantum: 0 } }).ok,
    ).toBe(false);
  });
  it('a configured hull retreat rule is evaluated before firing', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('defense') });
    const s = e.state.ships.find((s) => s.id === 'vigil')!;
    s.hull = 10;
    expect(shouldRetreat(s, e.state.orders[0])).toBe(true);
    run(e, 1);
    expect(e.state.orders[0].outcome).toBe('failed');
    expect(s.photon).toBe(0);
  });
});
describe('combat rules', () => {
  it('consumes torpedoes even on miss, consumes beam energy and respects cooldown and range', () => {
    const w = quietEngine().state,
      s = makeShip('s', 's', 'galaxy', 'starfleet', { x: 500, y: 500 }),
      t = makeEnemy('t', 'raider', 'pirate', { x: 550, y: 500 });
    let hits = 0;
    const hooks = {
      random: () => 1,
      hit: () => {
        hits++;
      },
      fired: () => {},
    };
    attack(w, s, t, hooks);
    expect(hits).toBe(0);
    expect(s.photon).toBe(35);
    expect(s.quantum).toBe(11);
    expect(s.core).toBe(240 - WEAPONS.arrays.cost - 2 - 3);
    const core = s.core;
    attack(w, s, t, hooks);
    expect(s.core).toBe(core);
    regenerate(s, 20, 20);
    t.x = 1000;
    attack(w, s, t, hooks);
    expect(s.photon).toBe(35);
    s.photon = 0;
    s.quantum = 0;
    s.core = 0;
    t.x = 550;
    attack(w, s, t, hooks);
    expect(s.core).toBe(0);
  });
  it('cloak prevents fire and decloaks before an attack with real energy drain', () => {
    const w = quietEngine().state,
      s = makeEnemy('s', 'valdore', 'romulan', { x: 500, y: 500 }),
      t = makeShip('t', 't', 'galaxy', 'starfleet', { x: 550, y: 500 });
    let shots = 0;
    const hooks = {
      random: () => 0,
      hit: () => {},
      fired: () => {
        shots++;
      },
    };
    const before = s.core;
    regenerate(s, 1, 1);
    expect(s.core).toBeLessThan(before);
    attack(w, s, t, hooks);
    expect(s.cloak).toBe('decloaking');
    expect(shots).toBe(0);
    w.time = 1;
    attack(w, s, t, hooks);
    expect(shots).toBe(0);
    w.time = 3;
    regenerate(s, 3, 2);
    attack(w, s, t, hooks);
    expect(shots).toBeGreaterThan(0);
  });
  it.each(['HOLD FIRE', 'RETURN FIRE', 'ENGAGE HOSTILES', 'WEAPONS FREE'] as ROE[])(
    'enforces %s and never attacks an unknown contact',
    (roe) => {
      const e = quietEngine();
      e.dispatchCommand({ type: 'createOrder', spec: { ...spec('defense'), roe } });
      const s = e.state.ships.find((s) => s.id === 'vigil')!,
        t = makeEnemy('t', 'raider', 'pirate', { x: s.x + 30, y: s.y });
      const o = e.state.orders[0];
      observe(e.state, t, 1);
      expect(permittedTarget(e.state, s, o, t)).toBe(false);
      observe(e.state, t, 10);
      s.lastAttackerId = t.id;
      s.attackedAt = 0;
      expect(permittedTarget(e.state, s, o, t)).toBe(roe !== 'HOLD FIRE');
      s.lastAttackerId = null;
      expect(permittedTarget(e.state, s, o, t)).toBe(
        roe === 'ENGAGE HOSTILES' || roe === 'WEAPONS FREE',
      );
    },
  );
  it('actual combat damages shields then hull, resolves an intercept and returns', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'horizon')!;
    const t = makeEnemy('victim', 'raider', 'pirate', { x: s.x - 70, y: s.y });
    t.hull = 60;
    t.shield = 0;
    t.nextDecision = 1e6;
    t.targetId = s.id;
    t.knownTargets = [{ id: s.id, x: s.x, y: s.y, seenAt: 0, score: 100 }];
    e.state.enemies = [t];
    observe(e.state, t, 10);
    e.dispatchCommand({
      type: 'createOrder',
      spec: { ...spec('defense', 'horizon'), objective: { type: 'contact', id: t.id } },
    });
    s.cooldowns = { phaser: 100, photon: 100, quantum: 100 };
    run(e, 0.1);
    expect(s.shield).toBeLessThan(330);
    expect(s.hull).toBe(380);
    s.cooldowns = {};
    until(e, () => e.state.orders[0].phase === 'complete');
    expect(e.state.orders[0].outcome).toBe('success');
    expect(s.photon).toBeLessThan(36);
  });
});
describe('fog of war and rule threats', () => {
  it('does not expose undiscovered positions, intent or raw enemy state anywhere in snapshot', () => {
    const e = new SimulationEngine(),
      json = JSON.stringify(e.snapshot());
    expect(json).not.toContain('enemy-1');
    expect(json).not.toContain('knownTargets');
    expect(json).not.toContain('nextIncursion');
    expect(json).not.toContain('"seed"');
    expect(e.snapshot().contacts).toHaveLength(0);
  });
  it('advances CONTACT → CLASSIFIED → IDENTIFIED → TRACKED and expires last position', () => {
    const e = quietEngine(),
      enemy = makeEnemy('t', 'scout', 'romulan', { x: 950, y: 430 });
    enemy.cloak = 'off';
    e.state.enemies = [enemy];
    observe(e.state, enemy, 1);
    expect(visibleIntel(e.state)[0].level).toBe('CONTACT');
    expect(visibleIntel(e.state)[0].name).toBeUndefined();
    observe(e.state, enemy, 2);
    expect(visibleIntel(e.state)[0].level).toBe('CLASSIFIED');
    expect(visibleIntel(e.state)[0].classId).toBeUndefined();
    observe(e.state, enemy, 3);
    expect(visibleIntel(e.state)[0].level).toBe('IDENTIFIED');
    observe(e.state, enemy, 4);
    expect(visibleIntel(e.state)[0].level).toBe('TRACKED');
    enemy.x = 1570;
    enemy.y = 30;
    e.state.time = 1;
    updateSensors(
      e.state,
      () => 1,
      () => {},
    );
    expect(e.snapshot().contacts[0].live).toBe(false);
    expect(e.snapshot().contacts[0].x).toBe(950);
    e.state.time = 31;
    expect(e.snapshot().contacts).toHaveLength(0);
    enemy.x = 950;
    enemy.y = 430;
    updateSensors(
      e.state,
      () => 0,
      () => {},
    );
    expect(e.snapshot().contacts[0].live).toBe(true);
  });
  it('cloaking lowers detection probability even inside starbase range', () => {
    const e = quietEngine(),
      enemy = makeEnemy('t', 'scout', 'romulan', { x: 1000, y: 430 });
    e.state.enemies = [enemy];
    updateSensors(
      e.state,
      () => 0.8,
      () => {},
    );
    expect(e.snapshot().contacts).toHaveLength(0);
    enemy.cloak = 'off';
    updateSensors(
      e.state,
      () => 0.8,
      () => {},
    );
    expect(e.snapshot().contacts).toHaveLength(1);
  });
  it('RETURN FIRE requires observed aggression against the protected object, not a private AI intention', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: { ...spec('defense'), roe: 'RETURN FIRE' } });
    const s = e.state.ships.find((s) => s.id === 'vigil')!,
      t = makeEnemy('t', 'raider', 'pirate', { x: s.x + 50, y: s.y });
    t.targetId = 'colony';
    t.behavior = 'engage';
    t.attackedAt = 0;
    const { record } = observe(e.state, t, 10),
      o = e.state.orders[0];
    expect(permittedTarget(e.state, s, o, t)).toBe(false);
    record.lastAttackTargetId = 'colony';
    record.lastAttackAt = 0;
    expect(permittedTarget(e.state, s, o, t)).toBe(true);
    e.state.time = 20;
    expect(permittedTarget(e.state, s, o, t)).toBe(false);
  });
  it('no order or scan can address an unseen enemy or leak its identity through errors', () => {
    const e = new SimulationEngine();
    const before = structuredClone(e.state);
    const result = e.dispatchCommand({
      type: 'createOrder',
      spec: { ...spec('defense'), objective: { type: 'contact', id: 'enemy-1' } },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).not.toContain('Pirate');
    expect(e.state).toEqual(before);
    expect(e.getObservation('ops-verity')!.contacts).toHaveLength(0);
  });
  it('safe routing uses known threats, not hidden enemy positions', () => {
    const e = quietEngine(),
      from = { x: 880, y: 430 },
      to = { x: 440, y: 660 },
      t = makeEnemy('hidden', 'raider', 'pirate', { x: 660, y: 545 });
    const before = planRoute(e.state, from, to, true, 'federation');
    e.state.enemies = [t];
    expect(planRoute(e.state, from, to, true, 'federation')).toEqual(before);
    observe(e.state, t, 10);
    expect(planRoute(e.state, from, to, true, 'federation')).not.toEqual(before);
    expect(planRoute(e.state, from, to, false, 'federation')).toEqual([to]);
  });
  it('pirates select profitable weak targets and retreat when damaged; Romulans can choose not to attack', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.status = 'mission';
    s.cargo.supplies = 60;
    s.x = 300;
    s.y = 650;
    const pirate = makeEnemy('pirate', 'raider', 'pirate', { x: 250, y: 650 });
    decideThreat(e.state, pirate);
    expect(pirate.targetId).toBe(s.id);
    pirate.hull = 10;
    e.state.time = 6;
    decideThreat(e.state, pirate);
    expect(pirate.intent).toBe('retreat');
    const romulan = makeEnemy('rom', 'valdore', 'romulan', { x: 1500, y: 100 });
    decideThreat(e.state, romulan);
    expect(romulan.targetId).toBeNull();
    expect(romulan.intent).toBe('observe');
  });
  it('spawns incursions at world entries and moves continuously instead of spawning at an order', () => {
    const e = new SimulationEngine();
    e.state.enemies = [];
    e.state.nextIncursion = 0.1;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
    expect(e.state.enemies).toHaveLength(1);
    const enemy = e.state.enemies[0];
    expect(enemy.x < 25 || enemy.x > 1560).toBe(true);
    const p = { x: enemy.x, y: enemy.y };
    e.step();
    expect(dist(p, enemy)).toBeLessThan(2);
  });
});
