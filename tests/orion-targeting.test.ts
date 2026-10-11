import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import { capabilities, cargoUsed } from '../src/engine/capabilities';
import { facilityCapabilities } from '../src/engine/definitions/facilities';
import { ORION_RULES as R } from '../src/engine/definitions/orion';
import { dist } from '../src/engine/navigation';
import { observeOrion } from '../src/engine/orion/intelligence';
import { planOrion } from '../src/engine/orion/tactics';
import { goodsCount } from '../src/engine/orion/piracy';
import { parseSave } from '../src/engine/saves';
import { advanceAgents } from '../src/engine/agents';
import { issue, run, until } from './helpers';
import { piracyScenario } from './orion-scenarios';
import { runScenario } from './domain-fixtures';

function freight(seed = 236807, shipId = 'meridian') {
  const e = new SimulationEngine(createWorld(seed));
  expect(e.dispatchCommand({ type: 'setPiracyPolicy', shipId, policy: 'manual' }).ok).toBe(true);
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
      shipId,
    ).ok,
  ).toBe(true);
  return e;
}
/** No repositioning, preloaded cargo, fabricated intelligence or injected encounter. */
function encounter(seed = 236807, shipId = 'meridian') {
  const e = freight(seed, shipId),
    ship = e.state.ships.find((s) => s.id === shipId)!,
    mine = e.state.locations.find((l) => l.id === 'mine')!;
  let loadedAt: number | undefined,
    departedAt: number | undefined,
    observedEmpty = false;
  until(
    e,
    () => {
      const reports = Object.values(e.state.orion.intelligence)
        .flat()
        .filter((r) => r.id === shipId);
      observedEmpty ||= reports.some((r) => r.cargoEstimate === 0);
      if (cargoUsed(ship) > 0) loadedAt ??= e.state.time;
      if (loadedAt !== undefined && dist(ship, mine) > facilityCapabilities(mine).range)
        departedAt ??= e.state.time;
      return e.state.piracyIncidents.some((i) => i.shipId === shipId);
    },
    180,
  );
  const incident = e.state.piracyIncidents.find((i) => i.shipId === shipId)!,
    op = e.state.orion.operations.find((o) => o.incidentId === incident.id)!;
  expect(observedEmpty).toBe(true);
  expect(loadedAt).toBeDefined();
  expect(departedAt).toBeGreaterThan(loadedAt!);
  expect(incident.created).toBeGreaterThanOrEqual(departedAt!);
  expect(ship.current?.carried).toBe(120);
  expect(ship.cargo.materials).toBe(120);
  expect(op.report.cargoEstimate).toBe(120);
  expect(
    e.state.locations
      .filter((l) => l.owner === 'starfleet')
      .every((l) => dist(ship, l) >= facilityCapabilities(l).range),
  ).toBe(true);
  expect(
    op.members.some((m) => {
      const pirate = e.state.enemies.find((s) => s.id === m.shipId)!;
      return dist(pirate, ship) < 150 && dist(pirate, ship) <= capabilities(pirate).sensors;
    }),
  ).toBe(true);
  expect(mine.attackedAt).toBeLessThan(0);
  expect(() => parseSave(e.state)).not.toThrow();
  return { e, ship, mine, incident, op };
}
/** Isolated spatial fixtures exercise scoring boundaries, using real sensor observation. */
function selection() {
  const scenario = piracyScenario('manual');
  const { e, ship } = scenario;
  e.state.orion.operations = [];
  e.state.orion.nextPlan = 0;
  for (const pirate of e.state.enemies) {
    pirate.intent = 'observe';
    pirate.targetId = null;
  }
  const mine = e.state.locations.find((l) => l.id === 'mine')!;
  mine.x = 0;
  mine.y = 1200;
  ship.x = 180;
  ship.y = 1200;
  for (const [index, pirate] of e.state.enemies.entries()) {
    pirate.x = 150 + index * 10;
    pirate.y = 1200;
  }
  e.state.orion.intelligence = {};
  return { ...scenario, mine };
}
function observeAndPlan(e: SimulationEngine) {
  observeOrion(e);
  e.state.orion.nextPlan = e.state.time;
  planOrion(e);
}
function continueEqually(e: SimulationEngine, minutes: number) {
  const restored = new SimulationEngine(parseSave(e.state));
  run(e, minutes);
  run(restored, minutes);
  expect(restored.state).toEqual(e.state);
  expect(() => parseSave(restored.state)).not.toThrow();
  return restored;
}

describe('Orion target selection and natural freight', () => {
  it.each([42, 1701, 236807])(
    'observes loading and intercepts real departing freight on seed %s',
    (seed) => {
      encounter(seed);
    },
  );
  it('targets another freighter without relying on MERIDIAN identity', () => {
    encounter(236807, 'meridian-2');
  });
  it.each(['comply', 'refuse'] as const)(
    'natural %s reaches real theft, withdrawal and sale',
    (response) => {
      const { e, ship, incident, op } = encounter();
      expect(
        e.dispatchCommand({
          type: 'respondPiracy',
          incidentId: incident.id,
          shipId: ship.id,
          response,
        }).ok,
      ).toBe(true);
      if (response === 'refuse') {
        until(e, () => op.phase === 'board', 40);
        expect(ship.shield).toBeLessThanOrEqual(capabilities(ship).shield * 0.05);
        expect(ship.engines).toBeLessThanOrEqual(20);
        expect(goodsCount(incident.lost)).toBe(0);
        run(e, 2);
        expect(incident.boardingWork).toBeGreaterThan(0);
        expect(goodsCount(incident.lost)).toBe(0);
      }
      until(e, () => op.phase === 'withdraw', 40);
      expect(incident.stage).toBe('resolved');
      expect(op.taken).toBeCloseTo(response === 'comply' ? 30 : 60);
      expect(goodsCount(incident.lost)).toBeCloseTo(op.taken);
      expect(ship.cargo.materials + goodsCount(incident.lost)).toBeCloseTo(120);
      expect(e.state.enemies.reduce((n, s) => n + s.loot, 0)).toBeCloseTo(op.taken);
      const completed = continueEqually(e, 240);
      const final = completed.state.orion.operations.find((o) => o.id === op.id)!;
      expect(final.status).toBe('complete');
      const unloaded = completed.state.orion.ledger
        .filter((l) => l.kind === 'unload')
        .reduce((n, l) => n + l.goods.materials, 0);
      const sold = completed.state.orion.ledger
        .filter((l) => l.kind === 'sale')
        .reduce((n, l) => n + l.goods.materials, 0);
      expect(unloaded).toBeCloseTo(op.taken);
      expect(sold).toBeCloseTo(op.taken * 0.25);
      expect(completed.state.piracyIncidents.filter((i) => i.shipId === ship.id)).toHaveLength(1);
    },
    15000,
  );
  it('empty freight creates monitoring opportunities but no piracy incident', () => {
    const { e, ship, mine } = selection();
    ship.cargo.materials = 0;
    observeAndPlan(e);
    expect(e.state.orion.operations).toHaveLength(0);
    run(e, 20);
    expect(e.state.enemies.some((s) => s.targetId === mine.id && s.intent === 'observe')).toBe(
      true,
    );
    expect(e.state.piracyIncidents).toHaveLength(0);
    expect(mine.attackedAt).toBeLessThan(0);
    expect(e.state.enemies.every((s) => dist(s, mine) >= facilityCapabilities(mine).range)).toBe(
      true,
    );
  });
  it('facility cover ends at its physical range, including nearby facilities', () => {
    const { e, ship, mine } = selection();
    ship.x = facilityCapabilities(mine).range - 1;
    observeAndPlan(e);
    const inside = e.state.orion.intelligence[e.state.enemies[0].id].find((r) => r.id === ship.id)!;
    expect(inside.escorts.find((s) => s.id === mine.id)?.defenseRange).toBe(110);
    expect(e.state.orion.operations).toHaveLength(0);
    ship.x = facilityCapabilities(mine).range + 1;
    e.state.tick = 10;
    e.state.time = 1;
    observeAndPlan(e);
    expect(e.state.orion.operations[0].targetId).toBe(ship.id);
    expect(e.state.orion.operations[0].report.escorts.some((s) => s.id === mine.id)).toBe(false);
  });
  it('fresh strong escort blocks selection and arriving escort aborts an existing ambush', () => {
    const { e, ship } = selection();
    const escort = e.state.ships.find((s) => s.id === 'horizon')!;
    escort.x = ship.x + R.escortRange;
    escort.y = ship.y;
    observeAndPlan(e);
    expect(e.state.orion.operations).toHaveLength(0);
    escort.x = -5000;
    e.state.tick = 10;
    e.state.time = 1;
    observeAndPlan(e);
    const op = e.state.orion.operations[0];
    expect(op.targetId).toBe(ship.id);
    escort.x = ship.x + R.escortRange;
    run(e, 0.1);
    expect(op.phase).toBe('withdraw');
    expect(op.reason).toContain('风险');
    expect(goodsCount(ship.cargo)).toBe(200);
  });
  it('even a weak facility load waits for departure, and preparation switches only outside its circle', () => {
    const { e, ship, mine } = selection();
    mine.hull = 300;
    mine.shield = 20;
    mine.stock.materials = 300;
    ship.x = 100;
    observeAndPlan(e);
    const op = e.state.orion.operations[0];
    expect(op.targetId).toBe(mine.id);
    expect(e.state.piracyIncidents).toHaveLength(0);
    ship.x = 111;
    e.state.time = 1;
    e.state.tick = 10;
    observeAndPlan(e);
    expect(op.targetId).toBe(ship.id);
  });
  it('a second observed facility still protects freight outside the source defense circle', () => {
    const { e, ship } = selection();
    const outpost = e.state.locations.find((l) => l.id === 'outpost')!;
    outpost.x = ship.x + 100;
    outpost.y = ship.y;
    observeAndPlan(e);
    expect(e.state.orion.operations).toHaveLength(0);
    const report = e.state.orion.intelligence[e.state.enemies[0].id].find((r) => r.id === ship.id)!;
    expect(report.escorts.find((s) => s.id === outpost.id)?.defenseRange).toBe(160);
  });
  it('a weak stocked facility can still be attacked and physically robbed', () => {
    const { e, ship, mine } = selection();
    ship.x = -5000;
    mine.hull = 300;
    mine.shield = 20;
    mine.stock.materials = 300;
    const stock = mine.stock.materials,
      extracted = mine.extracted;
    observeAndPlan(e);
    const op = e.state.orion.operations[0];
    expect(op.targetId).toBe(mine.id);
    until(e, () => op.taken > 0, 40);
    expect(mine.attackedAt).toBeGreaterThan(0);
    expect(mine.stock.materials + op.taken).toBeCloseTo(stock + mine.extracted - extracted);
    expect(e.state.piracyIncidents).toHaveLength(0);
  });
  it('profitable freight takes priority over much larger weak facility stock', () => {
    const { e, ship, mine } = selection();
    mine.hull = 90;
    mine.shield = 0;
    mine.stock.materials = 3000;
    observeAndPlan(e);
    expect(e.state.orion.operations[0].targetId).toBe(ship.id);
  });
  it('facility preparation can switch once to freight, resetting progress and preserving membership', () => {
    const { e, ship, mine } = selection();
    ship.cargo.materials = 0;
    mine.hull = 90;
    mine.shield = 0;
    mine.stock.materials = 300;
    observeAndPlan(e);
    const op = e.state.orion.operations[0],
      members = structuredClone(op.members);
    expect(op.targetId).toBe(mine.id);
    op.work = 2;
    op.transferWork = 1;
    ship.cargo.materials = 200;
    e.state.time = 1;
    e.state.tick = 10;
    observeAndPlan(e);
    expect(op.targetId).toBe(ship.id);
    expect(op.members).toEqual(members);
    expect(op.phase).toBe('deploy');
    expect(op.work).toBe(0);
    expect(op.transferWork).toBe(0);
    expect(op.initialCargo).toBe(200);
    expect(op.motion.observedAt).toBe(1);
    const restored = continueEqually(e, 0.1);
    expect(restored.state.orion.operations[0].targetId).toBe(ship.id);
    mine.stock.materials = 3000;
    observeAndPlan(e);
    expect(op.targetId).toBe(ship.id);
  });
  it('fired facility operations remain committed instead of retargeting mid-attack', () => {
    const { e, ship, mine } = selection();
    ship.cargo.materials = 0;
    mine.hull = 300;
    mine.shield = 20;
    mine.stock.materials = 300;
    observeAndPlan(e);
    const op = e.state.orion.operations[0];
    until(e, () => mine.attackedAt > 0, 30);
    ship.cargo.materials = 200;
    observeAndPlan(e);
    expect(op.targetId).toBe(mine.id);
  });
  it('lost targets expire without remote cargo theft and release the fleet to new observed freight', () => {
    const { e, ship, op } = piracyScenario('manual');
    ship.x = 4000;
    ship.y = 4000;
    run(e, R.tacticalTTL + 1);
    expect(op.phase).toBe('withdraw');
    expect(op.reason).toContain('失联');
    expect(ship.cargo.materials).toBe(200);
    expect(op.report.x).toBeLessThan(4000);
    until(e, () => op.status === 'aborted', 120);
    const next = e.state.ships.find((s) => s.id === 'meridian-2')!;
    next.x = e.state.enemies[0].x;
    next.y = e.state.enemies[0].y;
    next.cargo.materials = 200;
    observeAndPlan(e);
    until(
      e,
      () => e.state.orion.operations.some((o) => o.status === 'active' && o.targetId === next.id),
      20,
    );
    expect(e.state.piracyIncidents.some((i) => i.shipId === ship.id)).toBe(false);
  });
  it('unobserved cargo, route, command and facility changes never influence a private decision', () => {
    const { e } = selection();
    observeOrion(e);
    for (const enemy of e.state.enemies) {
      enemy.x = 2000;
      enemy.y = 2000;
    }
    const copy = new SimulationEngine(parseSave(e.state));
    const hidden = copy.state.ships.find((s) => s.id === 'meridian')!;
    hidden.cargo.materials = 600;
    hidden.path = [{ x: 2000, y: 2000 }];
    const mine = copy.state.locations.find((l) => l.id === 'mine')!;
    mine.stock.materials = 3000;
    mine.shield = 0;
    expect(issue(copy, { type: 'RETURN' }, hidden.id).ok).toBe(true);
    observeAndPlan(e);
    observeAndPlan(copy);
    expect(copy.state.orion.intelligence).toEqual(e.state.orion.intelligence);
    expect(copy.state.orion.operations).toEqual(e.state.orion.operations);
  });
  it('old range-free reports load conservatively and gain ranges only by renewed observation', () => {
    const { e, ship, mine } = selection();
    ship.x = 100;
    observeOrion(e);
    for (const reports of Object.values(e.state.orion.intelligence))
      for (const r of reports) {
        delete r.defenseRange;
        for (const support of r.escorts) delete support.defenseRange;
      }
    const restored = new SimulationEngine(parseSave(e.state));
    planOrion(restored);
    expect(restored.state.orion.operations).toHaveLength(0);
    restored.state.time = 1;
    restored.state.tick = 10;
    observeOrion(restored);
    expect(
      restored.state.orion.intelligence[restored.state.enemies[0].id].find((r) => r.id === mine.id)
        ?.defenseRange,
    ).toBe(110);
    expect(restored.state.version).toBe(16);
  });
  it('monitoring and natural boarding resume deterministically without duplicate transfers', () => {
    const e = freight();
    run(e, 60);
    expect(e.state.orion.operations).toHaveLength(0);
    expect(e.state.enemies.some((s) => s.targetId === 'mine')).toBe(true);
    continueEqually(e, 20);
    const { e: boarding, ship, incident, op } = encounter();
    boarding.dispatchCommand({
      type: 'respondPiracy',
      incidentId: incident.id,
      shipId: ship.id,
      response: 'refuse',
    });
    until(boarding, () => op.phase === 'board', 40);
    run(boarding, 2);
    const restored = continueEqually(boarding, 240);
    expect(restored.state.piracyIncidents.filter((i) => i.shipId === ship.id)).toHaveLength(1);
    expect(restored.state.piracyIncidents[0].lost.materials).toBeCloseTo(60);
  }, 15000);
  it('natural danger wakes Logistics once and an accepted Battle request physically rendezvous', () => {
    const { e, ship, incident } = encounter();
    const mira = e.state.agents.find((a) => a.id === 'ops-meridian')!;
    expect(mira.decision.pendingReasons.some((r) => r.includes(incident.id))).toBe(true);
    expect(e.getObservation(mira.id)!.rescueOptions).toContainEqual({
      agentId: 'ops-horizon',
      action: { type: 'ESCORT', targetId: ship.id },
    });
    advanceAgents(e, 0.1);
    expect(
      e.state.chatMessages.filter((m) => m.eventId === incident.id + ':danger:' + mira.id),
    ).toHaveLength(1);
    expect(
      runScenario(e, mira.id, {
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
      runScenario(e, 'ops-horizon', {
        coordination: {
          type: 'answerRequest',
          requestId: request.id,
          version: 1,
          response: 'accept',
          conditions: [],
          reason: 'risk',
        },
      }).ok,
    ).toBe(true);
    expect(request.rescueArrivedAt).toBeUndefined();
    until(e, () => request.rescueArrivedAt !== undefined, 80);
    const guard = e.state.ships.find((s) => s.id === 'horizon')!;
    expect(guard.current?.action).toEqual({ type: 'ESCORT', targetId: ship.id });
    expect(dist(guard, ship)).toBeLessThan(60);
    expect(
      e.state.history.filter((h) => h.kind === 'rescueArrived' && h.entityId === ship.id),
    ).toHaveLength(1);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
