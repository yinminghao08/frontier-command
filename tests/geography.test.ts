import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import {
  LOCATIONS,
  REGIONS,
  regionAt,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  FEDERATION_FRONTIER,
} from '../src/engine/definitions/locations';
import { worldSchema } from '../src/engine/save-schema';
import { worldV2Schema } from '../src/engine/save-v2';
import { migrateV2, parseSave } from '../src/engine/saves';
import { SaveStore } from '../electron/persistence';

const legacyV2 = () => {
  const v1 = JSON.parse(readFileSync('tests/fixtures/lv1/in-progress.json', 'utf8'));
  const fleet = createWorld().ships;
  return worldV2Schema.parse({
    ...v1,
    version: 2,
    ships: v1.ships.map(
      ({ operatorId: _operator, ...ship }: { operatorId: string; id: string }) => {
        const current = fleet.find((s) => s.id === ship.id)!;
        return { ...ship, classId: current.classId, factionId: current.factionId };
      },
    ),
  });
};
describe('strategic geography', () => {
  it('defines three contiguous regions and correctly typed landmarks', () => {
    expect([WORLD_WIDTH, WORLD_HEIGHT]).toEqual([1600, 800]);
    expect(REGIONS.map((r) => [r.from, r.to])).toEqual([
      [0, 1040],
      [1040, 1280],
      [1280, 1600],
    ]);
    expect([regionAt(1039), regionAt(1040), regionAt(1279), regionAt(1280)]).toEqual([
      'federation',
      'neutral',
      'neutral',
      'romulan',
    ]);
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
    expect(new Set(LOCATIONS.map((l) => l.kind))).toEqual(
      new Set(['base', 'colony', 'outpost', 'anomaly', 'border', 'mine', 'planet']),
    );
    for (const location of LOCATIONS) expect(location.regionId).toBe(regionAt(location.x));
    expect(LOCATIONS.find((l) => l.id === 'base')).toMatchObject({
      x: 880,
      y: 430,
      regionId: 'federation',
    });
    expect(worldSchema.safeParse(createWorld()).success).toBe(true);
    const invalid = createWorld();
    invalid.locations[0].regionId = 'romulan';
    expect(worldSchema.safeParse(invalid).success).toBe(false);
    invalid.locations = invalid.locations.filter((l) => l.id !== 'base');
    expect(worldSchema.safeParse(invalid).success).toBe(false);
  });
  it('retains the manual Federation movement boundary on the expanded map', () => {
    const e = new SimulationEngine();
    e.dispatchCommand({ type: 'takeControl', shipId: 'verity' });
    Object.assign(e.state.ships[0], { x: FEDERATION_FRONTIER - 0.1, heading: 0, throttle: 1 });
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
    expect(e.state.ships[0].x).toBe(FEDERATION_FRONTIER);
  });
  it('uses saved Dawn coordinates for return routing, docking and towing', () => {
    const world = parseSave(
      JSON.parse(readFileSync('tests/fixtures/lv1/in-progress.json', 'utf8')),
    );
    const base = world.locations.find((l) => l.id === 'base')!;
    expect(base).toMatchObject({ x: 260, y: 430 });
    const e = new SimulationEngine(world);
    e.dispatchCommand({ type: 'recall', shipId: 'verity' });
    expect(e.state.ships[0].path).toEqual([{ x: 260, y: 430 }]);
    Object.assign(e.state.ships[0], { x: 260, y: 430 });
    Object.assign(e.state.ships[1], { status: 'disabled', tow: 0.05 });
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
    expect(e.state.ships[0].status).toBe('docked');
    expect(e.state.ships[1]).toMatchObject({ x: 260, y: 430, status: 'docked', hull: 1 });
  });
});
describe('v2 to v3 persistence', () => {
  it('preserves effective state and numerical timers without mutating the input', () => {
    const legacy = legacyV2();
    legacy.speed = 2;
    legacy.ships[0].science = 72;
    const before = structuredClone(legacy);
    const next = migrateV2(legacy);
    expect(legacy).toEqual(before);
    expect(next.version).toBe(3);
    expect(next.speed).toBe(1);
    expect(next.ships).toEqual(legacy.ships);
    expect(next.resources).toEqual(legacy.resources);
    expect(next.contacts).toEqual(legacy.contacts);
    expect([next.tick, next.time, next.seed, next.nextIncursion]).toEqual([
      legacy.tick,
      legacy.time,
      legacy.seed,
      legacy.nextIncursion,
    ]);
    expect(
      next.locations
        .slice(0, legacy.locations.length)
        .map(({ regionId: _region, ...location }) => location),
    ).toEqual(legacy.locations);
    expect(next.locations).toHaveLength(12);
    expect(
      next.missions.map(({ requirement: _req, result: _result, ...mission }) => mission),
    ).toEqual(legacy.missions.map(({ requirement: _req, result: _result, ...mission }) => mission));
    expect(parseSave(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it.each([1, 4] as const)('retains supported legacy speed %i', (speed) => {
    expect(migrateV2({ ...legacyV2(), speed }).speed).toBe(speed);
  });
  it('recovers the newest legacy generation, retains its files and writes only v3', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-v2-upgrade-'));
    const store = new SaveStore(dir);
    const v1 = readFileSync('tests/fixtures/lv1/initial.json', 'utf8');
    const v2 = JSON.stringify(legacyV2());
    writeFileSync(join(dir, 'world-v1.json'), v1);
    writeFileSync(join(dir, 'world-v2.json'), 'broken');
    writeFileSync(join(dir, 'world-v2.json.bak'), v2);
    const result = store.read();
    expect(result.world?.tick).toBe(200);
    expect(result.message).toContain('备份');
    store.write(result.world!);
    expect(existsSync(join(dir, 'world-v3.json'))).toBe(true);
    expect(readFileSync(join(dir, 'world-v2.json'), 'utf8')).toBe('broken');
    expect(readFileSync(join(dir, 'world-v2.json.bak'), 'utf8')).toBe(v2);
    expect(readFileSync(join(dir, 'world-v1.json'), 'utf8')).toBe(v1);
    expect(store.read().world).toEqual(result.world);
  });
  it.each([2, 3])('does not roll back past a damaged generation %i', (generation) => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-generations-'));
    writeFileSync(join(dir, 'world-v1.json'), readFileSync('tests/fixtures/lv1/initial.json'));
    if (generation === 3) writeFileSync(join(dir, 'world-v2.json'), JSON.stringify(legacyV2()));
    writeFileSync(join(dir, 'world-v' + generation + '.json.bak'), 'broken');
    expect(new SaveStore(dir).read()).toMatchObject({ world: null, blocked: true });
  });
  it('blocks unsupported v2 generations instead of falling back to v1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-future-v2-'));
    writeFileSync(join(dir, 'world-v1.json'), readFileSync('tests/fixtures/lv1/initial.json'));
    writeFileSync(join(dir, 'world-v2.json'), JSON.stringify({ version: 99 }));
    expect(new SaveStore(dir).read()).toMatchObject({ world: null, blocked: true });
  });
});
