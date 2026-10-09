import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/engine';
import { createLastLightBattleWorld, isLastLightBattleWorld } from '../src/engine/last-light-battle';
import { parseSave } from '../src/engine/saves';

describe('LAST LIGHT second-act demo', () => {
  it('creates a separate validated world with two Galaxy agents and a cloaked VEIL', () => {
    const world = createLastLightBattleWorld();
    expect(parseSave(world).paused).toBe(true);
    expect(isLastLightBattleWorld(world)).toBe(true);
    expect(world.ships.find((s) => s.id === 'meridian')?.cargo.materials).toBe(500);
    expect(world.ships.find((s) => s.id === 'meridian')?.current?.phase).toBe('delivering');
    expect(world.agents.map((a) => a.name)).toEqual(['Mira', 'Talia', 'Rhea']);
    expect(world.ships.find((s) => s.id === 'veil')?.cloak).toBe('on');
    expect(world.enemies.filter((s) => s.factionId === 'orion')).toHaveLength(11);
  });
  it('deploys the raiders in one tick and raises one aggregated warning', () => {
    const e = new SimulationEngine(createLastLightBattleWorld());
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
    expect(e.state.history.some((h) => h.kind === 'lastLightAmbush')).toBe(true);
    expect(e.state.pauseReasons.filter((r) => r.kind === 'newContact')).toHaveLength(1);
    expect(e.state.chatMessages.filter((m) => m.eventId === 'lastLight:request:Mira')).toHaveLength(1);
    expect(e.state.enemies.find((s) => s.id === 'orion-escape')?.x).toBeGreaterThan(100);
  });
  it('orders both real Galaxy ships without including orion-escape', () => {
    const e = new SimulationEngine(createLastLightBattleWorld());
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
    e.dispatchCommand({ type: 'pause', paused: false });
    for (let i = 0; i < 8; i++) e.step();
    for (const id of ['horizon', 'resolute']) {
      const directive = e.state.ships.find((s) => s.id === id)?.current;
      expect(directive?.action.type).toBe('ATTACK_SET');
      if (directive?.action.type === 'ATTACK_SET')
        expect(directive.action.targetIds).not.toContain('orion-escape');
    }
    expect(e.state.chatMessages.filter((m) =>
      m.eventId === 'lastLight:accept:Talia' || m.eventId === 'lastLight:accept:Rhea')).toHaveLength(2);
  });
});
