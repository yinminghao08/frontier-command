import { describe, expect, it } from 'vitest';
import { createAgentDemoWorld } from '../src/engine/demo';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { until, run } from './helpers';

describe('ready-to-play v11 Agent Demo save', () => {
  it('starts paused with validated real escort/haul, confirmed passage, paid training and private/group chat', () => {
    const w = createAgentDemoWorld();
    expect(w.paused).toBe(true);
    expect(w.speed).toBe(16);
    expect(w.escortRequests[0].status).toBe('accepted');
    expect(w.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('HAUL');
    expect(w.ships.find((s) => s.id === 'horizon')!.current?.action.type).toBe('ESCORT');
    expect(w.wormholes.some((h) => h.discovered && h.surveyed && h.transits > 0)).toBe(true);
    expect(w.personnel.find((p) => p.status === 'training')!.training).toBeGreaterThan(85);
    expect(w.personnel.some((p) => p.status === 'candidate')).toBe(true);
    expect(w.history.some((h) => h.text.includes('录取60 + 训练90 Credits'))).toBe(true);
    expect(
      w.chatChannels
        .filter((c) => c.kind === 'private')
        .every((c) => w.chatMessages.some((m) => m.channelId === c.id)),
    ).toBe(true);
    expect(
      w.chatMessages.some((m) => m.mentions.includes('ops-horizon') && m.kind === 'request'),
    ).toBe(true);
    expect(parseSave(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(createAgentDemoWorld()).toEqual(w);
  });
  it('continues into real wormhole delivery, graduation, relationship/XP growth and deterministic save replay', () => {
    const e = new SimulationEngine(createAgentDemoWorld());
    const initialMaterials = e.base.stock.materials;
    const mine = e.state.locations.find((l) => l.id === 'demo-aurora-mine')!;
    const freighter = e.state.ships.find((s) => s.id === 'meridian')!;
    until(e, () => freighter.current?.phase === 'delivering' && freighter.current.journey !== null);
    expect(mine.stock.materials).toBe(80);
    expect(freighter.cargo.materials).toBe(40);
    expect(freighter.current?.journey?.legs.some((l) => l.type === 'wormhole')).toBe(true);
    const replay = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    until(e, () => e.state.escortRequests[0].status === 'completed');
    run(replay, (e.state.tick - replay.state.tick) / 10);
    expect(replay.state).toEqual(e.state);
    expect(e.base.stock.materials).toBe(initialMaterials + 40);
    expect(e.state.agents.some((a) => a.originPersonnelId && a.assignedShipId === null)).toBe(true);
    expect(e.state.agents.find((a) => a.id === 'ops-meridian')!.experience).toBeGreaterThan(0);
    expect(
      e.state.agents.find((a) => a.id === 'ops-horizon')!.relationships['ops-meridian'].trust,
    ).toBeGreaterThan(50);
    expect(e.state.chatMessages.some((m) => m.content.includes('HAUL 完成'))).toBe(true);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
