import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/engine/data';
import { regionAt, WORLD_WIDTH, WORLD_HEIGHT, BASE } from '../src/engine/definitions/locations';
import { move, authorized, segmentAllowed, planRoute } from '../src/engine/navigation';
import { SHIP_CLASSES } from '../src/engine/definitions/ships';
describe('strategic geography and fleet', () => {
  it('retains Step 1 geography and all landmarks', () => {
    const w = createWorld();
    expect([WORLD_WIDTH, WORLD_HEIGHT]).toEqual([1600, 800]);
    expect(BASE).toEqual({ x: 880, y: 430 });
    expect(w.locations.every((l) => l.regionId === regionAt(l.x, l.y))).toBe(true);
    for (const k of ['base', 'colony', 'mine', 'planet', 'anomaly'])
      expect(w.locations.some((l) => l.kind === k)).toBe(true);
  });
  it('has all seven requested classes and four initial Federation ships', () => {
    const w = createWorld();
    expect(w.ships).toHaveLength(4);
    for (const id of [
      'antares',
      'peregrine',
      'constitution',
      'galaxy',
      'scout',
      'valdore',
      'dderidex',
    ] as const) {
      const d = SHIP_CLASSES[id];
      expect(d.hull).toBeGreaterThan(0);
      expect(d.coreRegen).toBeGreaterThan(0);
      expect(d.sensors).toBeGreaterThan(0);
    }
  });
  it('movement respects the authorized territory', () => {
    for (const policy of ['federation', 'neutral', 'romulan'] as const) {
      const s = createWorld().ships[0];
      move(s, { x: 1590, y: 400 }, 10000, policy);
      expect(authorized(s, policy)).toBe(true);
      if (policy !== 'romulan') expect(s.x).toBe(createWorld().ships[0].x);
    }
  });
});

it('validates entire routes across curved borders and finds a legal detour', () => {
  const w = createWorld(),
    a = { x: 1040, y: 180 },
    b = { x: 1060, y: 530 };
  expect(authorized(a, 'federation')).toBe(true);
  expect(authorized(b, 'federation')).toBe(true);
  expect(segmentAllowed(a, b, 'federation')).toBe(false);
  const route = planRoute(w, a, b, false, 'federation');
  expect(route.length).toBeGreaterThan(1);
  let p = a;
  for (const next of route) {
    expect(segmentAllowed(p, next, 'federation')).toBe(true);
    p = next;
  }
});
