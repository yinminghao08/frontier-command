import { runScenario } from './domain-fixtures';
import { piracyScenario } from './orion-scenarios';
import { describe, it, expect } from 'vitest';
import { createWorld, makeEnemy, emptyStock } from '../src/engine/data';
import { SimulationEngine } from '../src/engine/engine';
import { quietEngine, run, until, issue } from './helpers';
import { capabilities, cargoUsed } from '../src/engine/capabilities';
import { observeOrion } from '../src/engine/orion/intelligence';
import { planOrion } from '../src/engine/orion/tactics';
import { transferCargo, openIncident, goodsCount } from '../src/engine/orion/piracy';
import {
  advanceOrionEconomy,
  serviceOrion,
  startOrionShipJob,
  startOrionConstruction,
} from '../src/engine/orion/economy';
import { ORION_BUILDS, ORION_RULES } from '../src/engine/definitions/orion';
import { parseSave } from '../src/engine/saves';
import { dist } from '../src/engine/navigation';
import { updateSiteIntel } from '../src/engine/tracking';
import { makeDirective } from '../src/engine/command-system';
import { advanceAgents } from '../src/engine/agents';

const decide = runScenario;
describe('seeded persistent Orion ecology', () => {
  it.each([0, 1, 42, 1701, 236807, 4294967295])(
    'seed %s creates ten dispersed ships and remote hidden real facilities',
    (seed) => {
      const w = createWorld(seed),
        e = new SimulationEngine(w),
        base = e.base,
        hq = w.locations.find((l) => l.id === 'orion-base')!;
      expect(w.enemies.filter((s) => s.factionId === 'orion')).toHaveLength(10);
      expect(
        w.enemies
          .filter((s) => s.factionId === 'orion')
          .map((s) => s.classId)
          .sort(),
      ).toEqual(
        [
          'orionScout',
          'orionScout',
          'orionRaider',
          'orionRaider',
          'orionRaider',
          'orionRaider',
          'orionInterceptor',
          'orionInterceptor',
          'orionCorsair',
          'orionSmuggler',
        ].sort(),
      );
      expect(dist(base, hq)).toBeGreaterThanOrEqual(1600);
      expect(
        Math.max(
          Math.abs(Math.round(hq.x / 400) - Math.round(base.x / 400)),
          Math.abs(Math.round(hq.y / 400) - Math.round(base.y / 400)),
        ),
      ).toBeGreaterThanOrEqual(4);
      expect(
        w.locations.filter((l) => l.defenseProfile === 'orionSupply').length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        w.locations.filter((l) => l.defenseProfile === 'orionSupply').length,
      ).toBeLessThanOrEqual(2);
      expect(
        new Set(w.enemies.filter((s) => s.factionId === 'orion').map((s) => s.x + ':' + s.y)).size,
      ).toBeGreaterThan(7);
      expect(w.orion.intelligence).toEqual({});
      expect(w.seed).toBe(seed >>> 0);
      expect(e.snapshot().locations.some((l) => l.owner === 'orion')).toBe(false);
      expect(() => parseSave(w)).not.toThrow();
      expect(createWorld(seed)).toEqual(w);
    },
  );
  it('begins reconnaissance and physical supply on the first active step', () => {
    const e = new SimulationEngine(createWorld());
    run(e, 1.2);
    const scouts = e.state.enemies.filter((s) => s.factionId === 'orion' && s.role === 'scout');
    expect(scouts.every((s) => s.destination !== null)).toBe(true);
    expect(scouts.some((s) => s.localReports.some((r) => r.kind === 'facility'))).toBe(true);
    expect(e.state.orion.logistics[0].work).toBeGreaterThan(0);
  });
  it.each([42, 1701, 236807])(
    'natural unescorted freight produces an encounter within 120 minutes on seed %s',
    (seed) => {
      const e = new SimulationEngine(createWorld(seed));
      expect(
        issue(
          e,
          {
            type: 'HAUL',
            sourceId: 'mine',
            targetId: 'base',
            cargoKind: 'materials',
            amount: 120,
            route: 'direct',
            repeat: false,
          },
          'meridian',
        ).ok,
      ).toBe(true);
      run(e, 120);
      expect(
        Object.values(e.state.orion.intelligence)
          .flat()
          .some((r) => r.id === 'meridian'),
      ).toBe(true);
      expect(
        e.state.orion.operations.some((op) => op.targetId === 'meridian' || op.targetId === 'mine'),
      ).toBe(true);
      expect(
        e.state.piracyIncidents.some((i) => i.shipId === 'meridian') ||
          e.state.locations.find((l) => l.id === 'mine')!.attackedAt > 0,
      ).toBe(true);
      expect(() => parseSave(e.state)).not.toThrow();
    },
  );
  it('unobserved cargo, paths, commands and reinforcements never change private decisions', () => {
    const { e, ship } = piracyScenario();
    e.state.orion.operations = [];
    e.state.orion.nextPlan = 0;
    e.state.orion.intelligence = {};
    for (const enemy of e.state.enemies) {
      enemy.x = 1000;
      enemy.y = 1200;
      enemy.intent = 'observe';
    }
    const copy = new SimulationEngine(parseSave(e.state));
    const far = copy.state.ships.find((s) => s.id === ship.id)!;
    far.cargo.materials = 600;
    far.path = [{ x: 2000, y: 2000 }];
    copy.state.ships.find((s) => s.id === 'horizon')!.x = 1500;
    observeOrion(e);
    observeOrion(copy);
    planOrion(e);
    planOrion(copy);
    expect(copy.state.orion.intelligence).toEqual(e.state.orion.intelligence);
    expect(copy.state.orion.operations).toEqual(e.state.orion.operations);
  });
  it('reports propagate by range in separate hops and expire using original observation time', () => {
    const e = quietEngine(),
      ship = e.state.ships[0];
    for (const s of e.state.ships) {
      s.x = -5000;
      s.y = -5000;
    }
    ship.x = 0;
    ship.y = 2000;
    ship.cargo.materials = 300;
    const scout = makeEnemy(
        'scouting',
        'orionScout',
        'orion',
        { x: 0, y: 2000 },
        'orion-base',
        'scout',
      ),
      relay = makeEnemy('relay', 'orionScout', 'orion', { x: 350, y: 2000 }, 'orion-base', 'scout'),
      raider = makeEnemy('waiting', 'orionRaider', 'orion', { x: 700, y: 2000 });
    e.state.enemies = [scout, relay, raider];
    observeOrion(e);
    expect(e.state.orion.intelligence.waiting.some((r) => r.id === ship.id)).toBe(false);
    e.state.tick = 10;
    e.state.time = 1;
    observeOrion(e);
    expect(e.state.orion.intelligence.waiting.find((r) => r.id === ship.id)?.seenAt).toBe(0);
    ship.x = -5000;
    e.state.tick = 1100;
    e.state.time = 110;
    observeOrion(e);
    expect(e.state.orion.intelligence.waiting).toEqual([]);
  });
  it('coordinated ships use distinct interception and flank positions and lose a changed course', () => {
    const { e, ship, op } = piracyScenario('manual');
    ship.x = 300;
    ship.y = 1200;
    op.phase = 'deploy';
    op.report.x = 300;
    op.report.velocity = { x: 5, y: 0 };
    op.report.seenAt = 0;
    run(e, 0.2);
    expect(new Set(e.state.enemies.map((s) => JSON.stringify(s.destination))).size).toBeGreaterThan(
      1,
    );
    ship.x = 4000;
    ship.y = 4000;
    const observed = { ...op.report };
    run(e, 14);
    expect(op.status === 'aborted' || (['withdraw'] as string[]).includes(op.phase)).toBe(true);
    expect(op.report.x).toBeLessThan(4000);
    expect(observed.x).toBeLessThan(4000);
  });
});
describe('extortion, boarding and actual cargo', () => {
  it('ship-preserving policy fulfills a timed bounded demand and sends loot home', () => {
    const { e, ship, home } = piracyScenario();
    until(e, () => e.state.piracyIncidents.some((i) => i.stage === 'resolved'), 25);
    const i = e.state.piracyIncidents[0];
    expect(i.responseSource).toBe('policy');
    expect(i.response).toBe('comply');
    expect(goodsCount(i.lost)).toBeCloseTo(50);
    expect(ship.cargo.materials).toBeCloseTo(150);
    until(e, () => e.state.orion.operations[0].status === 'complete', 100);
    expect(e.state.orion.market.stock.materials).toBeGreaterThan(0);
    expect(home.stock.materials).toBeGreaterThan(0);
    expect(e.state.enemies.reduce((n, s) => n + s.loot, 0)).toBeCloseTo(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('manual policy, Admiral override, spoof rejection and pause preserve the deadline and cargo', () => {
    const { e, ship } = piracyScenario('manual');
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    const i = e.state.piracyIncidents[0];
    e.state.paused = true;
    const time = e.state.time;
    for (let n = 0; n < 20; n++) e.step();
    expect(e.state.time).toBe(time);
    expect(ship.cargo.materials).toBe(200);
    expect(
      e.dispatchCommand({
        type: 'respondPiracy',
        incidentId: i.id,
        shipId: 'vigil',
        response: 'comply',
      }).ok,
    ).toBe(false);
    expect(
      e.dispatchCommand(
        { type: 'respondPiracy', incidentId: i.id, shipId: ship.id, response: 'comply' },
        'ops-meridian',
      ).ok,
    ).toBe(false);
    expect(
      e.dispatchCommand({
        type: 'respondPiracy',
        incidentId: i.id,
        shipId: ship.id,
        response: 'comply',
      }).ok,
    ).toBe(true);
    run(e, 1);
    expect(ship.cargo.materials).toBe(200);
    e.dispatchCommand({
      type: 'respondPiracy',
      incidentId: i.id,
      shipId: ship.id,
      response: 'refuse',
    });
    run(e, 0.2);
    expect(i.responseSource).toBe('admiral');
    expect(i.stage).toBe('attacked');
    expect(ship.cargo.materials).toBe(200);
  });
  it('refused demands lead to real shield and engine suppression and bounded boarding', () => {
    const { e, ship, op } = piracyScenario('manual');
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    e.dispatchCommand({
      type: 'respondPiracy',
      incidentId: e.state.piracyIncidents[0].id,
      shipId: ship.id,
      response: 'refuse',
    });
    until(e, () => op.phase === 'board', 35);
    expect(ship.engines).toBeLessThanOrEqual(20);
    expect(ship.shield).toBeLessThanOrEqual(capabilities(ship).shield * 0.05);
    const cargo = ship.cargo.materials;
    run(e, 2);
    expect(ship.cargo.materials).toBe(cargo);
    until(e, () => op.phase === 'withdraw', 30);
    expect(op.taken).toBeCloseTo(100);
    expect(ship.hull).toBeGreaterThan(capabilities(ship).hull * 0.4);
  });
  it('boarding progress resets on separation and never moves cargo remotely', () => {
    const { e, ship, op } = piracyScenario('manual');
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    e.dispatchCommand({
      type: 'respondPiracy',
      incidentId: e.state.piracyIncidents[0].id,
      shipId: ship.id,
      response: 'refuse',
    });
    ship.shield = 0;
    ship.engines = 0;
    until(e, () => op.phase === 'board', 5);
    run(e, 2);
    expect(op.work).toBeGreaterThan(1);
    ship.x += 1000;
    run(e, 0.2);
    expect(op.work).toBe(0);
    expect(e.state.piracyIncidents[0].boardingWork).toBe(0);
    expect(ship.cargo.materials).toBe(200);
    expect(goodsCount(transferCargo(e, ship, e.state.enemies[0], 50))).toBe(0);
  });
  it('Galaxy reinforcement is observed and causes a retreat instead of a lethal charge', () => {
    const { e, ship, op } = piracyScenario('manual');
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    const galaxy = e.state.ships.find((s) => s.id === 'horizon')!;
    galaxy.x = ship.x + 180;
    galaxy.y = ship.y;
    run(e, 0.2);
    expect(op.phase).toBe('withdraw');
    expect(op.reason).toContain('风险');
    expect(ship.cargo.materials).toBe(200);
  });
  it('physical motion interrupts boarding immediately and a new Admiral freight order stops voluntary transfer', () => {
    const { e, ship, op } = piracyScenario('manual');
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    const incident = e.state.piracyIncidents[0];
    e.dispatchCommand({
      type: 'respondPiracy',
      incidentId: incident.id,
      shipId: ship.id,
      response: 'refuse',
    });
    ship.shield = 0;
    ship.engines = 0;
    until(e, () => op.phase === 'board', 5);
    run(e, 2);
    ship.x += 4;
    run(e, 0.1);
    expect(op.phase).toBe('disable');
    expect(incident.boardingWork).toBe(0);
    expect(ship.cargo.materials).toBe(200);
    const fresh = piracyScenario('manual');
    until(fresh.e, () => fresh.e.state.piracyIncidents.length > 0, 5);
    const demand = fresh.e.state.piracyIncidents[0];
    fresh.e.dispatchCommand({
      type: 'respondPiracy',
      incidentId: demand.id,
      shipId: fresh.ship.id,
      response: 'comply',
    });
    until(fresh.e, () => fresh.ship.cargo.materials < 200, 10);
    const cargo = fresh.ship.cargo.materials;
    expect(cargo).toBeLessThan(200);
    expect(
      issue(
        fresh.e,
        {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 20,
          route: 'direct',
          repeat: false,
        },
        fresh.ship.id,
      ),
    ).toMatchObject({ ok: true });
    expect(demand.response).toBe('refuse');
    expect(demand.responseSource).toBe('admiral');
    run(fresh.e, 0.1);
    expect(fresh.ship.cargo.materials).toBe(cargo);
  });
  it('cargo loss updates the loaded directive and finite civilian delivery, including integral ammunition', () => {
    const { e, ship, a } = piracyScenario('manual');
    expect(
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 200,
          route: 'direct',
          repeat: false,
        },
        ship.id,
      ).ok,
    ).toBe(true);
    const d = ship.current!;
    d.carried = 200;
    d.phase = 'delivering';
    ship.current = d;
    a.x = ship.x;
    a.y = ship.y;
    const moved = transferCargo(e, ship, a, 15.5);
    expect(moved.materials).toBe(15.5);
    expect(d.lost).toBe(15.5);
    ship.cargo.photon = 3;
    const n = transferCargo(e, ship, a, 1.5);
    expect(Number.isInteger(n.photon)).toBe(true);
    expect(a.cargo.photon).toBe(1);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('actual nearby ship-to-ship transfer preserves the stolen manifest and capacity', () => {
    const { e, ship, a, b } = piracyScenario('manual');
    a.x = ship.x;
    a.y = ship.y;
    transferCargo(e, ship, a, 80);
    b.x = a.x;
    b.y = a.y;
    const before = a.loot + b.loot;
    const n = transferCargo(e, a, b, 30);
    expect(n.materials).toBe(30);
    expect(a.loot + b.loot).toBeCloseTo(before);
    expect(a.cargo.materials + b.cargo.materials).toBe(80);
  });
  it.each([180, 200])(
    'loaded freight losing %s units delivers only the remainder and earns only actual-delivery XP',
    (stolen) => {
      const { e, ship, a, b, c } = piracyScenario('manual');
      e.state.orion.operations = [];
      const d = makeDirective(e, {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 200,
        route: 'direct',
        repeat: false,
      });
      d.source = 'agent';
      d.actorId = 'ops-meridian';
      d.carried = 200;
      d.phase = 'delivering';
      ship.current = d;
      ship.x = e.base.x;
      ship.y = e.base.y;
      const before = e.base.stock.materials;
      for (const receiver of [a, b, c]) {
        receiver.x = ship.x;
        receiver.y = ship.y;
        transferCargo(e, ship, receiver, Math.max(0, stolen - (d.lost ?? 0)));
      }
      expect(d.lost).toBe(stolen);
      until(e, () => ship.current === null, 10);
      expect(e.base.stock.materials - before).toBe(200 - stolen);
      expect(e.state.agents.find((a) => a.id === 'ops-meridian')!.experience).toBe(
        (200 - stolen) / 5,
      );
      expect(() => parseSave(e.state)).not.toThrow();
    },
  );
  it('never extorts the same remaining load again, but detects a genuinely new load', () => {
    const { e, ship, op } = piracyScenario();
    until(e, () => op.status === 'complete', 100);
    run(e, 40);
    expect(e.state.piracyIncidents).toHaveLength(1);
    expect(e.state.orion.robbedTargets[ship.id].cargoEstimate).toBe(150);
    const restored = new SimulationEngine(parseSave(e.state));
    run(restored, 20);
    expect(restored.state.piracyIncidents).toHaveLength(1);
    ship.cargo.materials += 40;
    const scout = makeEnemy('fresh-load-observer', 'orionScout', 'orion', ship);
    e.state.enemies.push(scout);
    observeOrion(e);
    expect(e.state.orion.robbedTargets[ship.id]).toBeUndefined();
    e.state.orion.robbedTargets[ship.id] = {
      cargoEstimate: 150,
      seenAt: e.state.time,
      departed: false,
    };
    ship.cargo.materials = 0;
    e.state.tick++;
    e.state.time = e.state.tick / 10;
    observeOrion(e);
    expect(e.state.orion.robbedTargets[ship.id].cargoEstimate).toBe(0);
    ship.cargo.materials = 100;
    e.state.tick++;
    e.state.time = e.state.tick / 10;
    observeOrion(e);
    expect(e.state.orion.robbedTargets[ship.id]).toBeUndefined();
  });
  it('bulk boarding requires a real smuggler rendezvous to free the raiders and take 300 units', () => {
    const { e, ship, home } = piracyScenario('manual');
    ship.cargo.materials = 600;
    const smuggler = makeEnemy(
      'bulk-carrier',
      'orionSmuggler',
      'orion',
      { x: 10, y: 1200 },
      home.id,
      'smuggler',
    );
    e.state.enemies.push(smuggler);
    e.state.orion.operations = [];
    e.state.orion.nextPlan = 0;
    e.state.tick = 1;
    e.state.time = 0.1;
    for (const s of e.state.enemies) s.intent = 'observe';
    observeOrion(e);
    planOrion(e);
    const op = e.state.orion.operations[0];
    expect(op.members.some((m) => m.shipId === smuggler.id)).toBe(true);
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    e.dispatchCommand({
      type: 'respondPiracy',
      incidentId: e.state.piracyIncidents[0].id,
      shipId: ship.id,
      response: 'refuse',
    });
    until(e, () => op.phase === 'withdraw', 60);
    expect(op.taken).toBeCloseTo(300);
    expect(ship.cargo.materials).toBeCloseTo(300);
    expect(smuggler.loot).toBeGreaterThan(80);
    expect(e.state.orion.ledger.some((l) => l.kind === 'lootTransshipment')).toBe(true);
    expect(e.state.enemies.reduce((n, s) => n + s.cargo.materials, 0)).toBeCloseTo(300);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
describe('paid recovery, expansion and private save state', () => {
  it.each(Object.keys(ORION_BUILDS) as (keyof typeof ORION_BUILDS)[])(
    'builds %s only from paid resources and elapsed time, with empty magazines',
    (classId) => {
      const e = quietEngine(),
        home = e.state.locations.find((l) => l.id === 'orion-base')!,
        d = ORION_BUILDS[classId];
      home.stock.materials = d.materials;
      home.stock.photon = 20;
      e.state.factions.orion.credits = d.credits;
      expect(startOrionShipJob(e, home, classId)).toBe(true);
      expect(home.stock.materials).toBe(0);
      expect(e.state.factions.orion.credits).toBe(0);
      run(e, d.minutes - 0.2);
      expect(e.state.enemies).toHaveLength(0);
      run(e, 0.3);
      const s = e.state.enemies[0];
      expect(s.classId).toBe(classId);
      expect(s.photon).toBe(0);
      expect(s.quantum).toBe(0);
      expect(startOrionShipJob(e, home, classId)).toBe(false);
      expect(() => parseSave(e.state)).not.toThrow();
    },
  );
  it('fleet capacity includes paid jobs, headquarters loss cancels production, and losses are permanent', () => {
    const e = quietEngine(),
      home = e.state.locations.find((l) => l.id === 'orion-base')!;
    home.stock.materials = 500;
    e.state.factions.orion.credits = 2000;
    expect(startOrionShipJob(e, home, 'orionCorsair')).toBe(true);
    e.hit(home, 99999);
    expect(e.state.orion.jobs[0].status).toBe('lost');
    run(e, 100);
    expect(e.state.enemies).toHaveLength(0);
    home.hull = home.maxHull;
    home.occupation = null;
    home.stock.materials = 150;
    e.state.factions.orion.credits = 1000;
    for (let n = 0; n < 24; n++)
      e.state.enemies.push(makeEnemy('cap-' + n, 'orionRaider', 'orion', home, home.id));
    expect(startOrionShipJob(e, home, 'orionRaider')).toBe(false);
    const lost = e.state.enemies[0];
    e.hit(lost, 9999);
    expect(e.state.orion.shipLosses[0].id).toBe(lost.id);
    e.state.orion.servicedLoot[home.id] = { ...emptyStock(), materials: 40 };
    for (let n = 0; n < 2; n++) {
      e.state.tick += 10;
      e.state.time = e.state.tick / 10;
      advanceOrionEconomy(e, 0.1);
    }
    expect(startOrionShipJob(e, home, 'orionRaider')).toBe(true);
    expect(e.state.enemies.some((s) => s.id === lost.id)).toBe(false);
  });
  it('black-market exchanges obey buyer budget and warehouse capacity without duplicate sale after reload', () => {
    const e = quietEngine(),
      home = e.state.locations.find((l) => l.id === 'orion-base')!;
    home.stock.materials = 40;
    e.state.orion.servicedLoot[home.id] = { ...emptyStock(), materials: 20 };
    e.state.orion.market.credits = 25;
    e.state.tick = 10;
    e.state.time = 1;
    advanceOrionEconomy(e, 0.1);
    expect(home.stock.materials).toBe(35);
    expect(e.state.orion.market.stock.materials).toBe(5);
    expect(e.state.factions.orion.credits).toBe(25);
    const restored = new SimulationEngine(parseSave(e.state));
    advanceOrionEconomy(restored, 0.1);
    expect(restored.state.orion.market.stock.materials).toBe(5);
    e.state.orion.market.credits = 100;
    e.state.orion.market.capacity.materials = 5;
    advanceOrionEconomy(e, 0.1);
    expect(home.stock.materials).toBe(35);
  });
  it('finite repairs and ammunition consume local goods and time', () => {
    const { e, a, home } = piracyScenario();
    e.state.orion.operations = [];
    a.x = home.x;
    a.y = home.y;
    a.intent = 'retreat';
    a.hull -= 40;
    a.engines = 60;
    a.photon = 0;
    home.stock.materials = 1;
    home.stock.photon = 1;
    e.state.factions.orion.credits = 0;
    const before = a.hull;
    for (let n = 0; n < 30; n++) serviceOrion(e, a, 0.1);
    expect(a.hull).toBeLessThanOrEqual(before + 8);
    expect(home.stock.materials).toBeCloseTo(0);
    expect(home.stock.photon + a.photon).toBe(1);
  });
  it('small ammunition unloads accumulate export rights and sell only integral physical goods', () => {
    const { e, ship, a, home } = piracyScenario();
    e.state.orion.operations = [];
    ship.cargo.materials = 0;
    ship.cargo.photon = 8;
    a.x = ship.x;
    a.y = ship.y;
    transferCargo(e, ship, a, 8);
    a.x = home.x;
    a.y = home.y;
    a.photon = capabilities(a).photon;
    for (let n = 0; n < 10; n++) serviceOrion(e, a, 0.1);
    expect(home.stock.photon).toBe(8);
    expect(e.state.orion.servicedLoot[home.id].photon).toBe(2);
    e.state.tick = 10;
    e.state.time = 1;
    advanceOrionEconomy(e, 0.1);
    expect(home.stock.photon).toBe(6);
    expect(e.state.orion.market.stock.photon).toBe(2);
    expect(e.state.factions.orion.credits).toBe(24);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('growth above the ten-ship establishment requires realized sales even with ample initial stock', () => {
    const e = new SimulationEngine(createWorld()),
      home = e.state.locations.find((l) => l.id === 'orion-base')!;
    home.stock.materials = 200;
    e.state.factions.orion.credits = 1000;
    expect(startOrionShipJob(e, home, 'orionRaider')).toBe(false);
    e.state.orion.servicedLoot[home.id] = { ...emptyStock(), materials: 40 };
    for (let n = 0; n < 2; n++) {
      e.state.tick += 10;
      e.state.time = e.state.tick / 10;
      advanceOrionEconomy(e, 0.1);
    }
    expect(e.state.orion.realizedIncome).toBe(200);
    expect(startOrionShipJob(e, home, 'orionRaider')).toBe(true);
    const restored = new SimulationEngine(parseSave(e.state));
    run(e, 35.2);
    run(restored, 35.2);
    expect(restored.state).toEqual(e.state);
    expect(e.state.enemies.filter((s) => s.factionId === 'orion')).toHaveLength(11);
    expect(startOrionShipJob(e, home, 'orionRaider')).toBe(false);
  });
  it('partial-cargo remnants keep scouting, while four surviving supply points prevent a fifth paid site', () => {
    const e = quietEngine();
    for (const l of e.state.locations.filter((l) => l.owner === 'orion')) e.hit(l, 99999);
    const s = makeEnemy(
      'partial-remnant',
      'orionSmuggler',
      'orion',
      { x: -900, y: 1000 },
      'orion-base',
      'smuggler',
    );
    s.cargo.materials = 30;
    s.loot = 30;
    e.state.orion.lootCargo[s.id] = { ...emptyStock(), materials: 30 };
    e.state.enemies = [s];
    e.state.factions.orion.credits = 300;
    run(e, 10);
    expect(dist(s, { x: -900, y: 1000 })).toBeGreaterThan(20);
    expect(e.state.orion.jobs).toHaveLength(0);
    expect(() => parseSave(e.state)).not.toThrow();
    const full = new SimulationEngine(createWorld());
    const builder = full.state.enemies.find((s) => s.role === 'smuggler')!;
    for (
      let n = full.state.locations.filter((l) => l.defenseProfile === 'orionSupply').length;
      n < 4;
      n++
    ) {
      const site = structuredClone(
        full.state.locations.find((l) => l.defenseProfile === 'orionSupply')!,
      );
      site.id = 'capacity-site-' + n;
      site.x = 2000 + n * 400;
      full.state.locations.push(site);
    }
    builder.cargo.materials = 80;
    full.state.factions.orion.credits = 300;
    expect(startOrionConstruction(full, builder, { x: -900, y: 1400 })).toBe(false);
  });
  it('a surviving carrier physically rebuilds after total base loss; losing its construction cancels recovery', () => {
    const e = quietEngine();
    for (const l of e.state.locations.filter((l) => l.owner === 'orion')) e.hit(l, 99999);
    const s = makeEnemy(
      'remnant',
      'orionSmuggler',
      'orion',
      { x: -900, y: 1000 },
      'orion-base',
      'smuggler',
    );
    s.cargo.materials = 80;
    e.state.enemies = [s];
    e.state.factions.orion.credits = 300;
    until(
      e,
      () => e.state.orion.jobs.some((j) => j.kind === 'supply' && j.status === 'active'),
      15,
    );
    const j = e.state.orion.jobs[0];
    expect(s.cargo.materials).toBe(0);
    expect(e.state.factions.orion.credits).toBe(0);
    until(e, () => j.status === 'complete', 180);
    expect(e.state.locations.some((l) => l.owner === 'orion' && l.hull > 0)).toBe(true);
    expect(() => parseSave(e.state)).not.toThrow();
    const copy = quietEngine();
    for (const l of copy.state.locations.filter((l) => l.owner === 'orion')) copy.hit(l, 99999);
    const builder = makeEnemy('builder', 'orionSmuggler', 'orion', { x: -1000, y: 1600 });
    builder.cargo.materials = 80;
    copy.state.enemies = [builder];
    copy.state.factions.orion.credits = 300;
    until(copy, () => copy.state.orion.jobs.length > 0, 15);
    copy.hit(builder, 9999);
    run(copy, 150);
    expect(copy.state.orion.jobs[0].status).toBe('lost');
    expect(copy.state.enemies).toEqual([]);
    expect(copy.state.locations.every((l) => l.owner !== 'orion' || l.hull === 0)).toBe(true);
  });
  it('unconfirmed sites and every private plan, market, seed and loot ledger stay out of snapshots', () => {
    const { e, ship, home } = piracyScenario('manual');
    until(e, () => e.state.piracyIncidents.length > 0, 5);
    const bytes = JSON.stringify(e.snapshot());
    for (const key of [
      'intelligence',
      'realizedIncome',
      'counterTracking',
      'orion-operation-',
      'servicedLoot',
      'orion-job-',
      'marketPrices',
      'initialSeed',
      home.id,
    ])
      expect(bytes).not.toContain(key);
    ship.x = home.x;
    ship.y = home.y;
    for (let n = 0; n < 10; n++) {
      e.state.tick += 10;
      e.state.time = e.state.tick / 10;
      updateSiteIntel(e);
    }
    expect(home.discovered).toBe(false);
    e.state.tick += 10;
    e.state.time = e.state.tick / 10;
    updateSiteIntel(e);
    expect(home.discovered).toBe(true);
  });
  it.each([1, 4, 16] as const)(
    'replays fixed-step combat and in-progress boarding saves deterministically at %sx',
    (speed) => {
      const { e, ship, op } = piracyScenario('manual');
      until(e, () => e.state.piracyIncidents.length > 0, 5);
      e.dispatchCommand({
        type: 'respondPiracy',
        incidentId: e.state.piracyIncidents[0].id,
        shipId: ship.id,
        response: 'refuse',
      });
      ship.shield = 0;
      ship.engines = 0;
      until(e, () => op.phase === 'board', 5);
      run(e, 2);
      const restored = new SimulationEngine(parseSave(e.state)),
        reference = new SimulationEngine(parseSave(e.state));
      restored.state.speed = speed;
      reference.state.speed = speed;
      for (let n = 0; n < 160 / speed; n++) {
        restored.state.paused = false;
        restored.advanceFrame();
        for (let t = 0; t < speed; t++) {
          reference.state.paused = false;
          reference.step();
        }
      }
      expect(restored.state).toEqual(reference.state);
      expect(() => parseSave(restored.state)).not.toThrow();
    },
  );
  it.each(['assembly', 'withdrawal', 'supply', 'production', 'construction'] as const)(
    'resumes %s without duplicate transfers or completed assets',
    (phase) => {
      let e: SimulationEngine;
      if (phase === 'assembly' || phase === 'withdrawal') {
        const scenario = piracyScenario();
        e = scenario.e;
        if (phase === 'withdrawal') until(e, () => scenario.op.phase === 'withdraw', 25);
      } else if (phase === 'supply') {
        e = new SimulationEngine(createWorld());
        run(e, 1.5);
      } else {
        e = quietEngine();
        const home = e.state.locations.find((l) => l.id === 'orion-base')!;
        if (phase === 'production') {
          home.stock.materials = 28;
          e.state.factions.orion.credits = 160;
          expect(startOrionShipJob(e, home, 'orionRaider')).toBe(true);
          run(e, 17);
        } else {
          const builder = makeEnemy(
            'save-builder',
            'orionSmuggler',
            'orion',
            { x: -1100, y: 1600 },
            home.id,
            'smuggler',
          );
          builder.cargo.materials = 80;
          e.state.enemies = [builder];
          e.state.factions.orion.credits = 300;
          let started = false;
          for (let n = 0; n < 20 && !started; n++)
            started = startOrionConstruction(e, builder, { x: -1100 - n * 60, y: 1600 + n * 30 });
          expect(started).toBe(true);
          builder.x = e.state.orion.jobs[0].point.x;
          builder.y = e.state.orion.jobs[0].point.y;
          run(e, 20);
        }
      }
      const restored = new SimulationEngine(parseSave(e.state));
      run(e, 45);
      run(restored, 45);
      expect(restored.state).toEqual(e.state);
      expect(() => parseSave(restored.state)).not.toThrow();
    },
  );
  it('rejects unpaid job recipes, future intelligence, unknown members and inconsistent sale payments', () => {
    const { e, op } = piracyScenario();
    const badMember = structuredClone(e.state);
    badMember.orion.operations[0].members[0].shipId = 'invented';
    expect(() => parseSave(badMember)).toThrow();
    const future = structuredClone(e.state);
    future.orion.operations[0].report.seenAt = 10;
    expect(() => parseSave(future)).toThrow();
    const wrongSale = structuredClone(e.state);
    wrongSale.orion.ledger.push({
      id: 'forged-sale',
      time: 0,
      kind: 'sale',
      entityId: op.targetId,
      credits: 100,
      goods: emptyStock(),
    });
    wrongSale.orion.realizedIncome = 100;
    expect(() => parseSave(wrongSale)).toThrow();
    const job = quietEngine(),
      home = job.state.locations.find((l) => l.id === 'orion-base')!;
    home.stock.materials = 28;
    job.state.factions.orion.credits = 160;
    startOrionShipJob(job, home, 'orionRaider');
    job.state.orion.jobs[0].credits = 0;
    expect(() => parseSave(job.state)).toThrow();
  });
});
describe('Agent danger and reinforcement contracts', () => {
  it('a danger wake allows support coordination while Admiral freight work keeps final priority', () => {
    const { e, ship, a } = piracyScenario('manual');
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 120,
        route: 'direct',
        repeat: false,
      },
      ship.id,
    );
    const current = ship.current!.id;
    openIncident(e, ship, a, 50);
    advanceAgents(e, 0.1);
    const mira = e.state.agents.find((a) => a.id === 'ops-meridian')!;
    expect(mira.decision.pendingReasons.some((r) => r.includes('danger'))).toBe(true);
    expect(
      decide(e, mira.id, {
        coordination: {
          type: 'requestTask',
          kind: 'reinforce',
          agentId: 'ops-horizon',
          action: { type: 'ESCORT', targetId: ship.id },
          followUp: null,
          conditions: [],
        },
      }).ok,
    ).toBe(true);
    expect(ship.current!.id).toBe(current);
    expect(decide(e, mira.id, { action: { type: 'RETURN' } }).ok).toBe(false);
  });
  it('Logistics can request genuine Battle reinforcement with public observations and one danger wake', () => {
    const { e, ship, a, op } = piracyScenario('manual');
    const incident = openIncident(e, ship, a, 50);
    op.incidentId = incident.id;
    op.phase = 'extort';
    advanceAgents(e, 0.1);
    const mira = e.state.agents.find((a) => a.id === 'ops-meridian')!;
    expect(mira.decision.pendingReasons.some((r) => r.includes('danger'))).toBe(true);
    expect(e.getObservation(mira.id)!.rescueOptions).toEqual([
      { agentId: 'ops-horizon', action: { type: 'ESCORT', targetId: ship.id } },
    ]);
    const before = e.state.chatMessages.filter(
      (m) => m.eventId === incident.id + ':danger:' + mira.id,
    ).length;
    advanceAgents(e, 0.1);
    expect(
      e.state.chatMessages.filter((m) => m.eventId === incident.id + ':danger:' + mira.id),
    ).toHaveLength(before);
    expect(
      decide(e, mira.id, {
        coordination: {
          type: 'requestTask',
          kind: 'reinforce',
          agentId: 'ops-horizon',
          action: { type: 'ESCORT', targetId: ship.id },
          followUp: null,
          conditions: [],
        },
      }).ok,
    ).toBe(true);
    const request = e.state.escortRequests[0];
    expect(
      decide(e, 'ops-horizon', {
        coordination: {
          type: 'answerRequest',
          requestId: request.id,
          version: 1,
          response: 'accept',
          conditions: [],
          reason: 'risk',
        },
      }),
    ).toMatchObject({ ok: true });
    run(e, 2.2);
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current?.action).toEqual({
      type: 'ESCORT',
      targetId: ship.id,
    });
    request.started = true;
    expect(request.rescueArrivedAt).toBeUndefined();
    const responder = e.state.ships.find((s) => s.id === 'horizon')!;
    responder.x = ship.x + 50;
    responder.y = ship.y;
    advanceAgents(e, 0.1);
    expect(request.rescueArrivedAt).toBe(e.state.time);
    advanceAgents(e, 0.1);
    expect(e.state.history.filter((h) => h.kind === 'rescueArrived')).toHaveLength(1);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
