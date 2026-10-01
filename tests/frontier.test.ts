import { decideExecution } from '../src/engine/rules-controller';
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/engine';
import { makeEnemy, makeShip } from '../src/engine/data';
import { applyDamage } from '../src/engine/lifecycle';
import { decideThreat } from '../src/engine/threats';
import { observe, updateSensors } from '../src/engine/sensors';
import { SHIP_CLASSES } from '../src/engine/definitions/ships';
import { parseSave } from '../src/engine/saves';
import { quietEngine, run, spec, until } from './helpers';
import { worldSchema } from '../src/engine/save-schema';
describe('LV1 world acceptance', () => {
  it('Priority changes target choice using observed attacks on the protected objective', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('defense') });
    const o = e.state.orders[0],
      s = e.state.ships.find((s) => s.id === 'vigil')!;
    s.x = 430;
    s.y = 650;
    const near = makeEnemy('near', 'raider', 'pirate', { x: 455, y: 650 }),
      attacker = makeEnemy('attacker', 'raider', 'pirate', { x: 560, y: 650 });
    e.state.enemies = [near, attacker];
    observe(e.state, near, 10);
    const intel = observe(e.state, attacker, 10).record;
    intel.lastAttackTargetId = 'colony';
    intel.lastAttackAt = 0;
    const observation = e.getObservation('ops-vigil')!,
      point = { x: 440, y: 660 };
    expect(decideExecution(observation, o, point)).toEqual({ type: 'engage', contactId: 'near' });
    o.priority = 'urgent';
    expect(decideExecution(observation, o, point)).toEqual({
      type: 'engage',
      contactId: 'attacker',
    });
  });
  it('controller intents cannot bypass a held mission or commander-only reassignment', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('defense') });
    e.dispatchCommand({ type: 'holdOrder', orderId: 'order-1' });
    const port = e.controllerPort('ops-vigil');
    expect(port.submitIntent({ type: 'defend' }).ok).toBe(false);
    expect(port.submitIntent({ type: 'hold' }).ok).toBe(true);
    expect(
      port.dispatchCommand({ type: 'assignOperator', operatorId: 'ops-vigil', shipId: 'vigil' }).ok,
    ).toBe(false);
  });

  it('repair only restores the paid hull amount when new damage occurs during service', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.hull -= 20;
    const initial = s.hull,
      stock = e.base.stock.materials;
    expect(e.dispatchCommand({ type: 'repair', shipId: s.id }).ok).toBe(true);
    expect(e.base.stock.materials).toBe(stock - 10);
    s.shield = 0;
    applyDamage(e, s, 10);
    run(e, 10);
    expect(s.hull).toBeCloseTo(initial + 10);
    expect(s.status).toBe('docked');
  });
  it('Peregrine is pulse-only; Galaxy has a distinct array weapon', () => {
    expect(SHIP_CLASSES.peregrine.weapons).toEqual(['pulse']);
    expect(SHIP_CLASSES.peregrine.photon).toBe(0);
    expect(SHIP_CLASSES.galaxy.weapons).toEqual(['arrays', 'photon', 'quantum']);
  });
  it('hostile weapons can destroy Dawn and permanently freeze commands and time', () => {
    const e = quietEngine();
    e.state.ships.forEach((s) => {
      s.x = 100;
      s.y = 100;
    });
    e.base.hull = 1;
    e.base.shield = 0;
    const enemy = makeEnemy('raider', 'raider', 'pirate', { x: e.base.x + 30, y: e.base.y });
    e.state.enemies = [enemy];
    e.state.seed = 1;
    e.state.paused = false;
    decideThreat(e.state, enemy);
    expect(enemy.targetId).toBe('base');
    const core = enemy.core;
    const events = e.step();
    expect(enemy.core).toBeLessThan(core);
    expect(e.base.hull).toBe(0);
    expect(e.state.status).toBe('commandLost');
    expect(events.some((e) => e.type === 'commandLost')).toBe(true);
    const frozen = structuredClone(e.state);
    expect(e.dispatchCommand({ type: 'pause', paused: false }).ok).toBe(false);
    e.advanceFrame();
    expect(e.state).toEqual(frozen);
    const resumed = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    resumed.advanceFrame();
    expect(resumed.state).toEqual(e.state);
  });
  it('destroyed operators lose authority, archive persists and no scan, repair or rearm can revive a ship', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      actor = e.state.assignments.find((a) => a.shipId === s.id)!.operatorId;
    const port = e.controllerPort(actor);
    applyDamage(e, s, 10000);
    const event = e.pendingEvents.find((e) => e.type === 'shipDestroyed');
    expect(event).toMatchObject({ shipId: s.id, operatorIds: [actor] });
    expect(port.getObservation()).toBeNull();
    for (const type of ['scan', 'repair', 'rearm'] as const)
      expect(e.dispatchCommand({ type, shipId: s.id, load: { photon: 1, quantum: 0 } }).ok).toBe(
        false,
      );
    run(e, 200);
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    expect(restored.state.losses).toHaveLength(1);
    expect(restored.state.ships.some((x) => x.id === s.id)).toBe(false);
  });
  it('one defense asset can withdraw while the remaining assigned asset continues', () => {
    const e = quietEngine();
    e.dispatchCommand({
      type: 'createOrder',
      spec: { ...spec('defense'), shipIds: ['vigil', 'horizon'] },
    });
    e.state.ships.find((s) => s.id === 'vigil')!.hull = 10;
    run(e, 0.1);
    expect(e.state.orders[0].settled).toBe(false);
    expect(e.state.ships.find((s) => s.id === 'vigil')!.status).toBe('returning');
    expect(e.state.ships.find((s) => s.id === 'horizon')!.status).toBe('mission');
    until(e, () => e.state.orders[0].phase === 'complete');
    expect(e.state.orders[0].outcome).toBe('success');
  });
  it('assignments are independent, can be changed, and revoke the former controller immediately', () => {
    const e = quietEngine(),
      a = e.state.operators[0].id,
      b = e.state.operators[1].id;
    expect(e.dispatchCommand({ type: 'assignOperator', operatorId: a, shipId: null }).ok).toBe(
      true,
    );
    expect(e.controllerPort(a).getObservation()).toBeNull();
    expect(e.dispatchCommand({ type: 'assignOperator', operatorId: b, shipId: null }).ok).toBe(
      true,
    );
    expect(e.dispatchCommand({ type: 'assignOperator', operatorId: a, shipId: 'vigil' }).ok).toBe(
      true,
    );
    expect(e.controllerPort(a).getObservation()?.ship.id).toBe('vigil');
    expect(e.controllerPort(a).dispatchCommand({ type: 'scan', shipId: 'meridian' }).ok).toBe(
      false,
    );
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  });
  it('accepts a defense formation larger than the initial fleet without fixed entity caps', () => {
    const e = quietEngine();
    for (let i = 0; i < 24; i++) {
      const id = 'extra-' + i;
      e.state.ships.push(makeShip(id, id, 'peregrine', 'starfleet', e.base));
      e.state.operators.push({
        id: 'ops-' + id,
        name: id,
        kind: 'rules',
        availability: 'available',
      });
      e.state.assignments.push({ operatorId: 'ops-' + id, shipId: id, since: 0 });
    }
    expect(
      e.dispatchCommand({
        type: 'createOrder',
        spec: { ...spec('defense'), shipIds: e.state.ships.map((s) => s.id) },
      }).ok,
    ).toBe(true);
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  });
  it('Pirate raids actual stock then leaves alive with its loot instead of being marked destroyed', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'colony')!;
    e.state.ships.forEach((s) => {
      s.x = 1500;
      s.y = 50;
    });
    l.stock.supplies = 200;
    const pirate = makeEnemy('survivor', 'raider', 'pirate', { x: 20, y: 710 });
    e.state.enemies = [pirate];
    until(e, () => pirate.loot >= 20, 300);
    expect(pirate.cargo.supplies + pirate.cargo.medical + pirate.cargo.materials).toBe(20);
    until(e, () => pirate.departed, 300);
    expect(pirate.hull).toBeGreaterThan(0);
    expect(e.state.enemies).toHaveLength(0);
  });
  it('the unmodified frontier remains save-valid during a full game day or terminal loss', () => {
    const e = new SimulationEngine();
    for (let i = 0; i < 14400 && e.state.status === 'active'; i++) {
      if (e.state.paused) e.dispatchCommand({ type: 'pause', paused: false });
      e.step();
      if (i % 500 === 0) expect(worldSchema.safeParse(e.state).success).toBe(true);
    }
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  });
  it('Pirate profit preference changes with cargo and observed defensive risk', () => {
    const e = quietEngine();
    e.state.locations = e.state.locations.filter((l) => l.id === 'base');
    const cargo = e.state.ships[0];
    Object.assign(cargo, { x: 300, y: 650, status: 'mission' });
    cargo.cargo.supplies = 90;
    const pirate = makeEnemy('pirate', 'raider', 'pirate', { x: 280, y: 650 });
    decideThreat(e.state, pirate);
    expect(pirate.targetId).toBe(cargo.id);
    const escort = e.state.ships.find((s) => s.id === 'horizon')!;
    Object.assign(escort, { x: 310, y: 650, status: 'mission' });
    pirate.nextDecision = 0;
    decideThreat(e.state, pirate);
    expect(pirate.intent).toBe('retreat');
    expect(pirate.targetId).toBeNull();
  });
  it.each(['colony', 'mine', 'outpost'])(
    'Pirate considers an observed profitable %s and transfers stock',
    (id) => {
      const e = quietEngine(),
        l = e.state.locations.find((l) => l.id === id)!;
      e.state.ships.forEach((s) => {
        s.x = 1500;
        s.y = 50;
      });
      l.stock.supplies = 200;
      l.hull = 200;
      const pirate = makeEnemy('pirate', 'raider', 'pirate', { x: l.x + 30, y: l.y });
      e.state.enemies = [pirate];
      e.state.seed = 1;
      decideThreat(e.state, pirate);
      expect(pirate.targetId).toBe(id);
      const before = l.stock.supplies;
      run(e, 1);
      expect(l.stock.supplies).toBeLessThan(before);
      expect(pirate.cargo.supplies).toBeGreaterThan(0);
      expect(pirate.hull).toBeGreaterThan(0);
    },
  );
  it('Scout reports launch a distant Warbird; strong defense yields observation instead', () => {
    const scenario = (defended: boolean) => {
      const e = quietEngine(),
        cargo = e.state.ships[0];
      e.state.ships.forEach((s) => {
        s.x = 100;
        s.y = 100;
      });
      Object.assign(cargo, { x: 1120, y: 600, status: 'mission' });
      cargo.cargo.supplies = 80;
      if (defended) {
        const h = e.state.ships.find((s) => s.id === 'horizon')!;
        Object.assign(h, { x: 1130, y: 600, status: 'mission' });
        const c = e.state.ships.find((s) => s.id === 'verity')!;
        Object.assign(c, { x: 1135, y: 605, status: 'mission' });
      }
      const scout = makeEnemy('scout', 'scout', 'romulan', { x: 1160, y: 600 }),
        warbird = makeEnemy('warbird', 'valdore', 'romulan', { x: 1530, y: 600 });
      decideThreat(e.state, warbird);
      expect(warbird.targetId).toBeNull();
      decideThreat(e.state, scout);
      expect(e.state.romulanReports.find((r) => r.id === cargo.id)?.observerId).toBe(scout.id);
      warbird.nextDecision = 0;
      decideThreat(e.state, warbird);
      return warbird;
    };
    expect(scenario(false).intent).toBe('probe');
    expect(scenario(false).targetId).toBe('meridian');
    expect(scenario(true).intent).toBe('observe');
    expect(scenario(true).targetId).toBeNull();
  });
  it('stale Romulan reports cannot authorize a new raid and sensors do not read remote target inventory', () => {
    const e = quietEngine(),
      warbird = makeEnemy('bird', 'valdore', 'romulan', { x: 1530, y: 100 });
    e.state.time = 200;
    e.state.romulanReports = [
      {
        id: 'meridian',
        observerId: 'scout',
        x: 1000,
        y: 100,
        seenAt: 0,
        confidence: 1,
        value: 1000,
        defense: 0,
        kind: 'ship',
      },
    ];
    decideThreat(e.state, warbird);
    expect(warbird.intent).toBe('observe');
    expect(warbird.targetId).toBeNull();
  });
  it('hidden state changes do not leak through snapshots or frozen last-known coordinates', () => {
    const e = quietEngine(),
      enemy = makeEnemy('hidden', 'scout', 'romulan', { x: 1500, y: 60 });
    e.state.enemies = [enemy];
    const before = e.snapshot();
    Object.assign(enemy, { x: 1560, y: 750, core: 1, targetId: 'base' });
    e.state.romulanReports = [
      {
        id: 'base',
        observerId: enemy.id,
        x: 880,
        y: 430,
        seenAt: 0,
        confidence: 1,
        value: 500,
        defense: 0,
        kind: 'facility',
      },
    ];
    expect(e.snapshot()).toEqual(before);
    enemy.x = 900;
    enemy.y = 430;
    observe(e.state, enemy, 10);
    enemy.x = 1550;
    enemy.y = 40;
    e.state.time = 2;
    updateSensors(
      e.state,
      () => 1,
      () => {},
    );
    expect(e.snapshot().contacts[0]).toMatchObject({ x: 900, y: 430, live: false });
    const known = e.snapshot();
    enemy.x = 1400;
    enemy.y = 780;
    enemy.hull = 1;
    expect(e.snapshot()).toEqual(known);
    e.state.time = 40;
    expect(e.snapshot().contacts).toHaveLength(0);
  });
  it('close survey can permanently destroy an unshielded vessel and never rewards its loss', () => {
    const e = quietEngine();
    e.dispatchCommand({
      type: 'createOrder',
      spec: { ...spec('explore'), retreat: { hull: 0, shield: 0, core: 0, emptyAmmo: false } },
    });
    until(e, () => e.state.orders[0].phase === 'decision');
    e.dispatchCommand({ type: 'investigate', orderId: 'order-1', approach: 'close' });
    const s = e.state.ships.find((s) => s.id === 'verity')!;
    Object.assign(s, {
      x: e.state.locations.find((l) => l.id === 'anomaly1')!.x,
      y: 200,
      hull: 0.1,
      shield: 0,
      attackedAt: e.state.time,
    });
    s.path = [];
    run(e, 0.1);
    expect(e.state.ships.some((s) => s.id === 'verity')).toBe(false);
    expect(e.state.orders[0].outcome).toBe('failed');
    expect(e.state.resources.science).toBe(0);
  });
  it('survey consumes core while working and insufficient core causes failure', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
    until(e, () => e.state.orders[0].phase === 'decision');
    e.dispatchCommand({ type: 'investigate', orderId: 'order-1', approach: 'remote' });
    const s = e.state.ships.find((s) => s.id === 'verity')!;
    const core = s.core;
    run(e, 1);
    expect(s.core).toBeLessThan(core);
    s.core = 0;
    run(e, 0.1);
    expect(e.state.orders[0].outcome).toBe('failed');
  });
});
