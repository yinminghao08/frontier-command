import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorld } from '../src/engine/data';
import { SimulationEngine } from '../src/engine/engine';
import { FACTIONS } from '../src/engine/definitions/factions';
import { SHIP_CLASSES, INITIAL_FLEET } from '../src/engine/definitions/ships';
import { LOCATIONS } from '../src/engine/definitions/locations';
import { RESOURCE_DEFINITIONS } from '../src/engine/definitions/resources';
import { migrateV1, parseSave, UnsupportedSaveVersionError } from '../src/engine/saves';
import { worldSchema } from '../src/engine/save-schema';
import { worldV1Schema } from '../src/engine/save-v1';
import type { WorldState } from '../src/engine/types';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join('tests/fixtures/lv1', `${name}.json`), 'utf8'));
const run = (engine: SimulationEngine, seconds: number) => {
  engine.state.paused = false;
  for (let i = 0; i < seconds * 10; i++) engine.step();
};

describe('LV1 architecture compatibility', () => {
  it('matches the pre-refactor world and every deterministic checkpoint', () => {
    const engine = new SimulationEngine();
    expect(engine.state).toEqual(migrateV1(fixture('initial')));
    for (const [shipId, missionId, route] of [
      ['verity', 'amber', 'safe'],
      ['meridian', 'colony-run', 'fast'],
      ['vigil', 'r3', 'safe'],
    ] as const)
      expect(engine.dispatchCommand({ type: 'dispatch', shipId, missionId, route }).ok).toBe(true);
    run(engine, 20);
    expect(engine.state).toEqual(migrateV1(fixture('in-progress')));
    engine.dispatchCommand({ type: 'takeControl', shipId: 'verity' });
    engine.dispatchCommand({ type: 'helm', shipId: 'verity', turn: 0.3, throttle: 1 });
    run(engine, 10);
    expect(engine.state).toEqual(migrateV1(fixture('manual')));
    engine.dispatchCommand({ type: 'releaseControl', shipId: 'verity', resume: true });
    run(engine, 500);
    expect(engine.state).toEqual(migrateV1(fixture('continued')));
  });

  it('continues a migrated manual-control save identically to the original engine', () => {
    const engine = new SimulationEngine(parseSave(fixture('manual')));
    engine.dispatchCommand({ type: 'releaseControl', shipId: 'verity', resume: true });
    run(engine, 500);
    expect(engine.state).toEqual(migrateV1(fixture('continued')));
  });

  it.each(['initial', 'in-progress', 'manual', 'continued'])(
    'migrates %s without mutating input or losing effective state',
    (name) => {
      const input = worldV1Schema.parse(fixture(name));
      input.ships[0].science = 72;
      input.ships[0].speed = 5.1;
      input.locations[1].supply = 67;
      const before = structuredClone(input);
      const migrated = parseSave(input);
      const { version: _version, ships, ...rest } = migrated;
      expect(rest).toEqual((({ version: _v, ships: _s, ...rest }) => rest)(input));
      expect(ships.map(({ classId: _class, factionId: _faction, ...ship }) => ship)).toEqual(
        input.ships.map(({ operatorId: _operator, ...ship }) => ship),
      );
      expect(input).toEqual(before);
      expect(parseSave(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    },
  );
});

describe('definitions and controller ownership', () => {
  it('uses immutable definitions and creates independent mutable worlds', () => {
    for (const definitions of [
      FACTIONS,
      SHIP_CLASSES,
      LOCATIONS,
      RESOURCE_DEFINITIONS,
      INITIAL_FLEET,
    ]) {
      expect(Object.isFrozen(definitions)).toBe(true);
      for (const definition of Object.values(definitions))
        expect(Object.isFrozen(definition)).toBe(true);
    }
    for (const ship of INITIAL_FLEET) {
      expect(SHIP_CLASSES).toHaveProperty(ship.classId);
      expect(FACTIONS).toHaveProperty(ship.factionId);
    }
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
    const a = createWorld(),
      b = createWorld();
    a.ships[0].science = 1;
    a.locations[0].supply = 0;
    a.resources.materials = 0;
    a.operators[0].name = 'changed';
    expect(b).toEqual(createWorld());
    expect(SHIP_CLASSES.explorer.science).toBe(90);
    expect(LOCATIONS[0].supply).toBe(100);
  });

  it('resolves observation and permission from the operator assignment, not ship identity', () => {
    const world = createWorld();
    [world.operators[0].shipId, world.operators[2].shipId] = [
      world.operators[2].shipId,
      world.operators[0].shipId,
    ];
    expect(worldSchema.safeParse(world).success).toBe(true);
    const engine = new SimulationEngine(world);
    const port = engine.controllerPort('ops-verity');
    expect(port.getObservation()?.ship.id).toBe('vigil');
    const before = structuredClone(engine.state);
    expect(port.dispatchCommand({ type: 'scan', shipId: 'verity' }).ok).toBe(false);
    expect(engine.state).toEqual(before);
    const observation = port.getObservation()!;
    observation.ship.hull = 0;
    observation.resources.materials = 0;
    expect(engine.state).toEqual(before);
    expect(
      port.dispatchCommand({ type: 'dispatch', shipId: 'vigil', missionId: 'k7', route: 'safe' })
        .ok,
    ).toBe(true);
    engine.dispatchCommand({ type: 'takeControl', shipId: 'vigil' });
    expect(port.getObservation()?.legalActions).toEqual([]);
    expect(port.dispatchCommand({ type: 'recall', shipId: 'vigil' }).ok).toBe(false);
    expect(engine.controllerPort('missing').getObservation()).toBeNull();
    expect(
      engine.controllerPort('missing').dispatchCommand({ type: 'scan', shipId: 'vigil' }).ok,
    ).toBe(false);
    expect(
      engine.controllerPort('commander').dispatchCommand({ type: 'pause', paused: false }).ok,
    ).toBe(false);
  });
});

describe('versioned schema validation', () => {
  it.each([
    (w: WorldState) => {
      w.operators[0].shipId = 'missing';
    },
    (w: WorldState) => {
      w.operators[1].shipId = w.operators[0].shipId;
    },
    (w: WorldState) => {
      w.operators[0].id = w.commander.id;
    },
    (w: WorldState) => {
      w.ships[1].id = w.ships[0].id;
    },
    (w: WorldState) => {
      w.locations[0].id = 'missing-definition';
    },
    (w: WorldState) => {
      w.missions[0].locationId = 'missing';
    },
  ])('rejects inconsistent references and identities (%#)', (corrupt) => {
    const world = createWorld();
    corrupt(world);
    expect(worldSchema.safeParse(world).success).toBe(false);
  });

  it('rejects unknown definition IDs, including inherited property names', () => {
    const world = createWorld();
    for (const field of ['classId', 'factionId'])
      for (const value of ['unknown', 'constructor', '__proto__'])
        expect(
          worldSchema.safeParse({
            ...world,
            ships: [{ ...world.ships[0], [field]: value }, ...world.ships.slice(1)],
          }).success,
        ).toBe(false);
  });

  it('keeps LV1 counts in initialization rather than imposing them on v2', () => {
    const world = createWorld();
    world.ships.push({ ...structuredClone(world.ships[0]), id: 'another-ship' });
    world.operators.push({
      id: 'another-operator',
      name: 'rules',
      kind: 'rules',
      shipId: 'another-ship',
    });
    world.missions = [];
    expect(worldSchema.safeParse(world).success).toBe(true);
  });

  it('rejects unsupported versions and malformed legacy data', () => {
    expect(() => parseSave({ ...createWorld(), version: 9 })).toThrow(UnsupportedSaveVersionError);
    expect(() => parseSave({})).toThrow();
    const legacy = worldV1Schema.parse(fixture('initial'));
    legacy.ships[0].operatorId = 'missing';
    expect(() => migrateV1(legacy)).toThrow();
  });
});
