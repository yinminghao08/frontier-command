import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { advanceLastLight, isLastLightWaiting } from '../src/engine/last-light';
import type { Objective, WorldState } from '../src/engine/types';

function prepare() {
  const input = JSON.parse(readFileSync('tests/fixtures/demo/agent-demo-v16.json', 'utf8')) as WorldState;
  const world = parseSave(input);
  const old = world.agents.find((a) => a.id === 'ops-horizon')!;
  world.agents.push({ ...structuredClone(old), id: 'ops-resolute-demo', name: 'Rhea' });
  const pirate = world.enemies.find((s) => s.id === 'orion-raider-4')!;
  pirate.id = 'orion-escape';
  const meridian = world.ships.find((s) => s.id === 'meridian')!;
  meridian.cargo.materials = 20;
  const template = world.objectives[0];
  world.objectives.push({
    ...(template || {}),
    id: 'test-aurora-haul',
    ownerAgentId: 'ops-meridian',
    status: 'active',
    goal: {
      kind: 'operation',
      action: { type: 'HAUL', sourceId: 'demo-aurora-mine', targetId: 'base',
        cargoKind: 'materials', amount: 20, loadPolicy: 'fixed', route: 'risky', repeat: false },
    },
  } as Objective);
  const engine = new SimulationEngine(world);
  const base = engine.state.locations.find((l) => l.id === 'base')!;
  return { engine, base };
}
describe('LAST LIGHT world-only ambush', () => {
  it('waits without a real physical return', () => {
    const { engine } = prepare();
    advanceLastLight(engine);
    expect(isLastLightWaiting(engine.state)).toBe(true);
    expect(engine.pending).toHaveLength(0);
  });
  it('deploys all pirates with only 20 real Materials and one group warning', () => {
    const { engine, base } = prepare();
    const ship = engine.state.ships.find((s) => s.id === 'meridian')!;
    engine.pendingEvents.push({
      type: 'shipTransited', shipId: ship.id,
      destination: { x: base.x + 100, y: base.y + 100 }, tick: engine.state.tick,
    });
    const pirates = engine.state.enemies.filter((s) => s.factionId === 'orion' && s.hull > 0);
    advanceLastLight(engine);
    expect(isLastLightWaiting(engine.state)).toBe(false);
    expect(pirates.every((s) => Math.hypot(s.x - ship.x, s.y - ship.y) <= 180)).toBe(true);
    expect(engine.pending.filter((r) => r.kind === 'newContact')).toHaveLength(1);
    advanceLastLight(engine);
    expect(engine.pending.filter((r) => r.kind === 'newContact')).toHaveLength(1);
  });
});
