import { describe, it, expect } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { makeEnemy, emptyStock } from '../src/engine/data';
import { observe, updateSensors } from '../src/engine/sensors';
import { decideThreat, advanceEnemy } from '../src/engine/threats';
import { capabilities } from '../src/engine/capabilities';
import { BUILD_COSTS } from '../src/engine/definitions/progression';
import { worldSchema } from '../src/engine/save-schema';
import { move } from '../src/engine/navigation';
import { canDetectShip } from '../src/engine/tracking';
describe('frontier construction and capabilities', () => {
  it.each(['mine', 'outpost', 'colony'] as const)(
    'builds %s only after on-site cargo arrives, without claiming ships',
    (kind) => {
      const e = quietEngine();
      let site = e.state.bodies.find(
        (b) =>
          b.discovered &&
          (kind === 'mine' ? b.kind === 'resource' : b.kind === 'planet' && b.habitable),
      )!;
      const fresh = {
        ...site,
        id: 'construction-test-site',
        x: site.x + 90,
        y: site.y + 90,
        remaining: 3000,
      };
      e.state.bodies.push(fresh);
      e.state.systems.find((sys) => sys.id === site.systemId)!.bodyIds.push(fresh.id);
      site = fresh;
      site.survey = 2;
      expect(
        e.dispatchCommand({ type: 'startConstruction', siteId: site.id, kind, name: 'New ' + kind })
          .ok,
      ).toBe(true);
      const p = e.state.projects[0];
      run(e, 30);
      expect(p.work).toBe(0);
      expect(e.state.ships.every((s) => !s.current)).toBe(true);
      const s = e.state.ships[0];
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'base',
          targetId: p.id,
          cargoKind: 'materials',
          amount: p.cost.materials + 10,
          route: 'direct',
          repeat: false,
        },
        s.id,
      );
      until(e, () => p.complete, 600);
      const l = e.state.locations.find((l) => l.siteId === site.id && l.kind === kind)!;
      expect(l).toBeDefined();
      expect(l.hull).toBeGreaterThan(600);
      expect(l.shield).toBeGreaterThan(300);
      expect(l.stock.materials).toBeGreaterThan(0);
      expect(l.stock.materials).toBeLessThanOrEqual(l.capacity.materials);
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'base',
          targetId: p.id,
          cargoKind: 'materials',
          amount: 5,
          route: 'direct',
          repeat: false,
        },
        s.id,
      );
      until(e, () => !s.current);
      expect(l.stock.materials).toBeGreaterThan(0);
      expect(l.stock.materials).toBeLessThanOrEqual(l.capacity.materials);
      expect(() => worldSchema.parse(e.state)).not.toThrow();
    },
  );
  it('module slots limit installations; abilities change physics and target validation', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.x = e.base.x;
    s.y = e.base.y;
    const old = capabilities(s);
    issue(e, { type: 'REFIT', targetId: 'base', moduleId: 'expandedCargo', remove: false }, s.id);
    until(e, () => !s.current);
    expect(capabilities(s).cargo).toBe(old.cargo + 50);
    issue(
      e,
      { type: 'REFIT', targetId: 'base', moduleId: 'longRangeSensors', remove: false },
      s.id,
    );
    until(e, () => !s.current);
    expect(capabilities(s).sensors).toBe(old.sensors * 2);
    expect(
      issue(
        e,
        { type: 'REFIT', targetId: 'base', moduleId: 'reinforcedShields', remove: false },
        s.id,
      ).ok,
    ).toBe(false);
    expect(issue(e, { type: 'EXPLORE', sector: { q: 0, r: 2 }, approach: 'remote' }, s.id).ok).toBe(
      true,
    );
  });
  it('Deep Scan reveals hidden bodies; Precision Targeting enables engines/weapons selection', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      sys = e.state.systems[0];
    const hidden = {
      ...e.state.bodies[0],
      id: 'deep-test',
      kind: 'anomaly' as const,
      systemId: sys.id,
      hidden: true,
      discovered: false,
    };
    e.state.bodies.push(hidden);
    sys.bodyIds.push(hidden.id);
    e.base.stock.specialFinds = 2;
    e.state.resources.credits = 1000;
    e.base.stock.materials = 200;
    issue(e, { type: 'REFIT', targetId: 'base', moduleId: 'deepScan', remove: false }, s.id);
    until(e, () => !s.current);
    issue(e, { type: 'SURVEY', targetId: sys.id, approach: 'remote', deep: true }, s.id);
    until(e, () => !s.current);
    expect(e.snapshot().bodies.some((b) => b.hidden)).toBe(true);
    s.x = 300;
    s.y = 600;
    const enemy = makeEnemy('precise', 'raider', 'orion', { x: s.x + 40, y: s.y });
    e.state.enemies.push(enemy);
    observe(e.state, enemy, 6);
    expect(issue(e, { type: 'DISABLE', targetId: enemy.id, subsystem: 'weapons' }, s.id).ok).toBe(
      false,
    );
    s.modules.push('precisionTargeting');
    expect(issue(e, { type: 'DISABLE', targetId: enemy.id, subsystem: 'weapons' }, s.id).ok).toBe(
      true,
    );
    enemy.shield = 0;
    enemy.nextDecision = 1e9;
    until(e, () => enemy.weapons === 0 || !e.state.enemies.includes(enemy), 50);
    expect(enemy.weapons).toBe(0);
    expect(enemy.hull).toBeGreaterThan(0);
  });
  it('Reinforced Shields changes hazardous-route endurance', () => {
    const a = quietEngine(),
      b = quietEngine();
    b.state.ships[0].modules = ['reinforcedShields'];
    for (const e of [a, b]) {
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'base',
          targetId: 'outpost',
          cargoKind: 'materials',
          amount: 10,
          route: 'risky',
          repeat: false,
        },
        'meridian',
      );
      run(e, 60);
    }
    expect(b.state.ships[0].shield).toBeGreaterThan(a.state.ships[0].shield);
  });
  it('base upgrades unlock advanced hulls, efficient manufacturing, sensor nodes, persistent routes and platforms', () => {
    const e = quietEngine();
    e.state.resources.credits = 5000;
    e.base.stock.materials = 500;
    e.base.stock.specialFinds = 4;
    expect(e.dispatchCommand({ type: 'buildShip', classId: 'galaxy', name: 'USS NEW' }).ok).toBe(
      false,
    );
    expect(e.dispatchCommand({ type: 'manufacture', cargoKind: 'quantum', amount: 4 }).ok).toBe(
      true,
    );
    for (const upgradeId of ['shipyard', 'armory', 'sensors', 'logistics', 'defense'] as const)
      expect(e.dispatchCommand({ type: 'upgrade', upgradeId }).ok).toBe(true);
    run(e, 16);
    expect(Object.values(e.state.upgrades)).toEqual([1, 1, 1, 1, 1]);
    expect(e.dispatchCommand({ type: 'buildShip', classId: 'galaxy', name: 'USS NEW' }).ok).toBe(
      true,
    );
    const q = e.base.stock.quantum;
    expect(e.dispatchCommand({ type: 'manufacture', cargoKind: 'quantum', amount: 4 }).ok).toBe(
      true,
    );
    run(e, 26);
    expect(e.state.ships.find((s) => s.name === 'USS NEW')?.photon).toBe(0);
    expect(e.base.stock.quantum).toBe(q + 4);
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'outpost',
        cargoKind: 'photon',
        amount: 5,
        route: 'direct',
        repeat: true,
      },
      'meridian',
    );
    run(e, 400);
    expect(e.state.locations.find((l) => l.id === 'outpost')!.stock.photon).toBeGreaterThanOrEqual(
      10,
    );
  });
  it('all-ship loss recovers through colony income and real paid delivery, never base production', () => {
    const e = quietEngine();
    for (const s of [...e.state.ships]) e.hit(s, 10000);
    e.finishCritical();
    e.state.resources.credits = 0;
    e.base.stock = emptyStock();
    run(e, 150);
    expect(e.base.stock.materials).toBe(0);
    expect(
      e.dispatchCommand({
        type: 'tradeStock',
        direction: 'buy',
        cargoKind: 'materials',
        amount: 20,
      }).ok,
    ).toBe(true);
    run(e, 400);
    expect(e.base.stock.materials).toBe(20);
    expect(
      e.dispatchCommand({ type: 'buildShip', classId: 'peregrine', name: 'USS RECOVERY' }).ok,
    ).toBe(true);
    run(e, 25);
    expect(e.state.ships).toHaveLength(1);
    expect(e.state.losses).toHaveLength(6);
    expect(e.state.ships[0].id).not.toBe('vigil');
  });
  it('renames persist independently of stable IDs and history is not truncated by communication rolls', () => {
    const e = quietEngine();
    for (const entityId of [
      'verity',
      'base',
      e.state.systems[0].id,
      e.state.bodies.find((b) => b.kind === 'planet')!.id,
    ])
      expect(e.dispatchCommand({ type: 'renameEntity', entityId, name: 'Admiral Name' }).ok).toBe(
        true,
      );
    for (let i = 0; i < 250; i++) e.record('example', 'Permanent ' + i, 'base');
    expect(e.state.history.length).toBe(254);
    expect(e.state.communications.length).toBe(100);
  });
});
describe('persistent Orion and Romulan ecology', () => {
  it('sensors see actual boosted warp emissions, while unread route orders and paths give no contact', () => {
    for (const route of ['safe', 'direct', 'risky'] as const) {
      const e = quietEngine(),
        s = e.state.ships[0];
      const scout = makeEnemy(
        'distant-scout',
        'raider',
        'orion',
        { x: 1000, y: 0 },
        'orion-base',
        'scout',
      );
      e.state.enemies = [scout];
      s.x = scout.x + capabilities(scout).sensors * 1.25;
      s.y = scout.y;
      s.cargo.materials = 100;
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 100,
          route,
          repeat: false,
        },
        s.id,
      );
      s.path = [{ x: s.x + 20, y: s.y }];
      expect(canDetectShip(scout, s, e.state.time)).toBe(false);
      move(s, s.path[0], 0.1, route === 'risky' ? 1.5 : 1);
      decideThreat(e, scout);
      expect(scout.localReports.some((r) => r.id === s.id)).toBe(route === 'risky');
      s.path = [];
      move(s, { x: s.x + 10, y: s.y }, 0.1);
      expect(canDetectShip(scout, s, e.state.time)).toBe(false);
      e.state.factions.orion.reports = [];
      scout.localReports = [];
      scout.nextDecision = 0;
      decideThreat(e, scout);
      expect(scout.localReports.find((r) => r.id === s.id)?.seenAt).toBe(
        route === 'risky' ? 0 : undefined,
      );
    }
  });
  it('locally observed traffic launches coordinated work, and an observed heavy escort makes the same traffic unattractive', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    for (const ship of e.state.ships) {
      ship.x = -4000;
      ship.y = -4000;
    }
    s.x = 100;
    s.y = 1000;
    s.cargo.materials = 200;
    const raider = makeEnemy('r', 'orionRaider', 'orion', { x: 80, y: 1000 });
    e.state.enemies = [raider];
    decideThreat(e, raider);
    expect(raider.intent).toBe('assemble');
    expect(raider.targetId).toBe(s.id);
    e.state.orion.operations = [];
    e.state.orion.nextPlan = 0;
    raider.intent = 'observe';
    raider.targetId = null;
    const escort = e.state.ships[3];
    escort.x = s.x;
    escort.y = s.y;
    decideThreat(e, raider);
    expect(raider.intent).toBe('observe');
    expect(e.state.orion.operations).toEqual([]);
  });
  it('timed extortion steals actual cargo and physically returns it to a persistent hideout', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    for (const ship of e.state.ships) {
      ship.x = -4000;
      ship.y = -4000;
    }
    const home = e.state.locations.find((l) => l.id === 'orion-base')!;
    home.x = 500;
    home.y = 1000;
    s.x = 600;
    s.y = 1000;
    s.cargo.materials = 40;
    s.shield = 0;
    s.hull = 50;
    s.standing.roe = 'HOLD FIRE';
    const raider = makeEnemy('thief', 'orionRaider', 'orion', { x: 590, y: 1000 }, home.id);
    e.state.enemies = [raider];
    decideThreat(e, raider);
    run(e, 1);
    expect(s.cargo.materials).toBe(40);
    until(e, () => e.state.piracyIncidents.some((i) => i.stage === 'resolved'), 30);
    expect(s.cargo.materials).toBe(30);
    expect(raider.loot).toBeGreaterThan(0);
    until(e, () => raider.loot === 0, 100);
    expect(e.state.enemies).toContain(raider);
    expect(home.stock.materials).toBeGreaterThan(0);
    expect(e.state.history.some((h) => h.kind === 'cargoLoss')).toBe(true);
  });
  it('destroyed ships reduce real assets and cannot respawn without industrial resources', () => {
    const e = quietEngine(),
      r = makeEnemy('r', 'raider', 'orion', { x: 0, y: 0 });
    e.state.enemies = [r];
    const home = e.state.locations.find((l) => l.id === 'orion-base')!;
    home.stock = emptyStock();
    e.state.factions.orion.credits = 0;
    e.hit(r, 9999);
    run(e, 600);
    expect(e.state.enemies.filter((s) => s.factionId === 'orion')).toHaveLength(0);
    expect(e.state.factions.orion.losses).toContain('r');
    home.stock = { ...emptyStock(), materials: 20, photon: 5 };
    e.state.factions.orion.credits = 100;
    run(e, 31);
    expect(e.state.enemies).toHaveLength(1);
    expect(home.stock.materials).toBe(2);
    expect(e.state.factions.orion.credits).toBe(0);
  });
  it('neutral Romulans are excluded from autonomous attack; explicit attack raises political tension', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      r = makeEnemy(
        'rom-test',
        'scout',
        'romulan',
        { x: s.x + 30, y: s.y },
        'romulan-base',
        'scout',
      );
    r.cloak = 'off';
    r.nextDecision = 1e9;
    e.state.enemies = [r];
    s.standing.roe = 'ENGAGE HOSTILES';
    updateSensors(e);
    run(e, 4);
    expect(r.shield).toBe(capabilities(r).shield);
    expect(e.state.tension).toBe(0);
    issue(e, { type: 'ATTACK', targetId: r.id }, s.id);
    run(e, 1);
    expect(e.state.tension).toBeGreaterThanOrEqual(45);
    expect(r.shield).toBeLessThan(capabilities(r).shield);
  });
  it('Border Command escalates from fresh reports and tension, producing one major pause', () => {
    const e = quietEngine();
    e.state.tension = 70;
    e.state.factions.romulan.reports = [
      {
        id: 'verity',
        observerId: 'romulan-scout',
        seenAt: 0,
        value: 100,
        defense: 300,
        kind: 'ship',
        x: 900,
        y: 0,
      },
    ];
    run(e, 5);
    expect(e.state.factions.romulan.stance).toBe('escalate');
    expect(
      e.state.history.filter((h) => h.kind === 'border' && h.text.includes('军事升级声明')),
    ).toHaveLength(1);
  });
  it('an ordinary raid leaves facilities alive while reinforcement travels from Dawn', () => {
    const e = quietEngine(),
      mine = e.state.locations.find((l) => l.id === 'mine')!,
      r = makeEnemy('ordinary-raid', 'raider', 'orion', { x: mine.x + 70, y: mine.y });
    e.state.enemies = [r];
    r.intent = 'raid';
    r.targetId = mine.id;
    r.destination = mine;
    r.nextDecision = 1e9;
    e.state.factions.orion.reports = [
      {
        id: mine.id,
        observerId: r.id,
        seenAt: 0,
        value: 200,
        defense: 500,
        kind: 'facility',
        x: mine.x,
        y: mine.y,
      },
    ];
    issue(e, { type: 'PATROL', targetId: mine.id, duration: 120 }, 'vigil');
    until(e, () => Math.hypot(e.state.ships[1].x - mine.x, e.state.ships[1].y - mine.y) < 100, 150);
    expect(mine.hull).toBeGreaterThan(0);
    expect(e.base.x).toBeLessThan(0);
    expect(mine.shield + mine.hull).toBeGreaterThan(300);
  });
});

describe('faction recovery, political actions and long-lived save invariants', () => {
  it('empty mine inventory never creates operating shortages and actual attacks still alert', () => {
    const e = quietEngine(),
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    mine.stock.materials = 0;
    run(e, 5);
    expect(mine.distress).toBe(false);
    expect(e.snapshot().opportunities.every((o) => !o.id.startsWith('supply:'))).toBe(true);
    expect(e.snapshot().opportunities.some((o) => o.id === 'defend:' + mine.id)).toBe(false);
    e.hit(mine, 5);
    expect(
      e.state.communications.some(
        (c) => c.entityId === mine.id && c.category === 'threat' && c.priority === 'urgent',
      ),
    ).toBe(true);
    expect(e.snapshot().opportunities.some((o) => o.id === 'defend:' + mine.id)).toBe(true);
    run(e, 31);
    expect(e.snapshot().opportunities.some((o) => o.id === 'defend:' + mine.id)).toBe(false);
  });
  it('a surviving raider finishes funded repairs and redeploys after returning loot', () => {
    const e = quietEngine(),
      home = e.state.locations.find((l) => l.id === 'orion-base')!,
      r = makeEnemy('redeploy', 'raider', 'orion', home);
    e.state.enemies = [r];
    r.intent = 'retreat';
    r.cargo.materials = 12;
    r.loot = 12;
    e.state.orion.lootCargo[r.id] = { ...emptyStock(), materials: 12 };
    home.stock.materials = 15;
    home.stock.photon = 3;
    r.hull = 80;
    r.photon = 0;
    run(e, 15);
    expect(r.loot).toBe(0);
    expect(r.intent).not.toBe('docked');
    expect(r.hull).toBe(95);
    expect(r.photon).toBeGreaterThanOrEqual(2);
    expect(e.state.enemies).toContain(r);
    expect(() => worldSchema.parse(e.state)).not.toThrow();
  });
  it('border crossing and withdrawal change tension through actual travel', () => {
    const e = quietEngine(),
      s = e.state.ships[1];
    s.x = 770;
    s.y = 0;
    issue(e, { type: 'MOVE', point: { x: 1000, y: 0 } }, s.id);
    until(e, () => !s.current, 40);
    expect(e.state.tension).toBe(20);
    issue(e, { type: 'MOVE', point: { x: 700, y: 0 } }, s.id);
    until(e, () => !s.current, 50);
    expect(e.state.tension).toBe(12);
    expect(e.state.history.filter((h) => h.kind === 'borderTransit')).toHaveLength(4);
  });
  it('enemy bases retain working self defense after discovery', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      home = e.state.locations.find((l) => l.id === 'orion-base')!;
    home.discovered = true;
    s.x = home.x + 40;
    s.y = home.y;
    issue(e, { type: 'ATTACK', targetId: home.id }, s.id);
    run(e, 4);
    expect(s.shield).toBeLessThan(capabilities(s).shield);
    expect(home.shield).toBeLessThan(home.maxShield);
  });
  it.each([42, 1701, 236807])(
    'seed %s runs for twenty game-hours with valid stocks, histories and references',
    (seed) => {
      const e = quietEngine(seed);
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 60,
          route: 'direct',
          repeat: true,
        },
        'horizon',
      );
      run(e, 1200);
      expect(() => worldSchema.parse(e.state)).not.toThrow();
    },
  );
});
