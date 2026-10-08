import { describe, expect, it } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { makeEnemy, makeLocation } from '../src/engine/data';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { worldSchema } from '../src/engine/save-schema';
import { updateSensors } from '../src/engine/sensors';
import { journeyOptions, planJourney } from '../src/engine/journey';
import { appendChat, COMMAND_CHANNEL, privateChannel } from '../src/engine/chat';
import type { AgentDecision, Action } from '../src/engine/types';
const logisticsId = 'ops-meridian',
  battleId = 'ops-horizon';
function decide(e: SimulationEngine, agentId: string, changes: Partial<AgentDecision> = {}) {
  const agent = e.state.agents.find((a) => a.id === agentId)!;
  return e.dispatchCommand(
    {
      type: 'agentDecision',
      agentId,
      revision: agent.decision.revision,
      decision: {
        goal: '确保真实库存抵达目的地',
        rationale: '根据公开库存、风险与同僚状态决定',
        action: null,
        messages: [],
        memory: null,
        waitMinutes: 30,
        coordination: null,
        ...changes,
      },
    },
    agentId,
  );
}
export function knownPassageFixture() {
  const e = quietEngine();
  const h = e.state.wormholes.find((h) => h.id === 'wormhole:0:0')!;
  h.stable = true;
  h.stability = 1;
  const scout = e.state.ships.find((s) => s.id === 'verity')!;
  scout.x = h.x;
  scout.y = h.y;
  expect(issue(e, { type: 'TRANSIT', targetId: h.id }, scout.id).ok).toBe(true);
  run(e, 2.2);
  const source = makeLocation('remote-mine', 'AURORA MINE', 'mine', {
    x: scout.x + 110,
    y: scout.y + 40,
  });
  source.stock.materials = 120;
  e.state.locations.push(source);
  const freighter = e.state.ships.find((s) => s.id === 'meridian')!,
    escort = e.state.ships.find((s) => s.id === 'horizon')!;
  freighter.x = source.x;
  freighter.y = source.y;
  escort.x = source.x + 20;
  escort.y = source.y;
  return { e, h, source, freighter, escort };
}
describe('v11 independent Agents, chat and real commands', () => {
  it('Battle ATTACK damages and destroys a real confirmed hostile, then records XP and outcome memory', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'horizon')!;
    const target = makeEnemy('agent-combat-target', 'raider', 'orion', {
      x: ship.x + 100,
      y: ship.y,
    });
    target.weapons = 0;
    target.nextDecision = 10000;
    e.state.enemies.push(target);
    updateSensors(e);
    e.state.intel.find((i) => i.id === target.id)!.hostile = true;
    expect(decide(e, battleId, { action: { type: 'ATTACK', targetId: target.id } }).ok).toBe(false);
    ship.standing.roe = 'ENGAGE HOSTILES';
    expect(decide(e, battleId, { action: { type: 'ATTACK', targetId: target.id } }).ok).toBe(true);
    until(e, () => !e.state.enemies.some((enemy) => enemy.id === target.id) && !ship.current);
    const agent = e.state.agents.find((a) => a.id === battleId)!;
    expect(target.hull).toBe(0);
    expect(agent.experience).toBeGreaterThan(0);
    expect(agent.memory.some((m) => m.kind === 'outcome' && m.summary.includes('ATTACK'))).toBe(
      true,
    );
    expect(
      e.state.chatMessages.some((m) => m.origin === 'engine' && m.content.includes('ATTACK 完成')),
    ).toBe(true);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('initial Battle and Logistics are independent Operator entities with complete, public observations', () => {
    const e = quietEngine(),
      obs = e.controllerPort(logisticsId).getObservation()!;
    expect(obs.self?.career).toBe('logistics');
    expect(obs.ship?.classId).toBe('antares');
    expect(obs.legalActions).toEqual(
      expect.arrayContaining(['HAUL', 'ESCORT', 'REPAIR', 'REFIT', 'UNLOAD', 'DOCK']),
    );
    expect(e.getObservation(battleId)!.legalActions).toContain('REARM');
    expect(obs.inventories.find((i) => i.locationId === 'mine')?.available.materials).toBe(120);
    expect(obs.logisticsNeeds.some((n) => n.targetId === 'base')).toBe(true);
    expect(obs.journeys.length).toBeGreaterThan(0);
    expect(obs.channels).toHaveLength(2);
    const serialized = JSON.stringify(obs);
    for (const hidden of [
      'initialSeed',
      'counterTracking',
      'nextDecision',
      'orion-base',
      'romulan-base',
      'encryptedKey',
      'apiKey',
    ])
      expect(serialized).not.toContain(hidden);
    expect(obs.wormholes[0].exit).toBeNull();
    expect(
      decide(e, battleId, {
        action: {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 10,
          route: 'safe',
          repeat: false,
        },
      }).ok,
    ).toBe(true);
    const d = e.state.ships.find((s) => s.id === 'horizon')!.current!;
    expect(d.source).toBe('agent');
    expect(d.actorId).toBe(battleId);
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  });
  it('Admiral current, queue and suspended commands block autonomous actions, including direct dispatch', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'meridian')!;
    const action: Action = { type: 'MOVE', point: { x: 1, y: 1 } };
    expect(decide(e, logisticsId, { action }).ok).toBe(true);
    expect(issue(e, { type: 'DOCK', targetId: 'base' }, ship.id, 'INTERRUPT').ok).toBe(true);
    expect(e.controllerPort(logisticsId).getObservation()?.legalActions).toEqual([]);
    expect(e.submitAction(logisticsId, action).ok).toBe(false);
    expect(
      e.dispatchCommand(
        { type: 'issueDirective', shipIds: [ship.id], action, mode: 'REPLACE' },
        logisticsId,
      ).ok,
    ).toBe(false);
    expect(ship.current?.source).toBe('admiral');
    expect(ship.current?.actorId).toBe('commander');
    expect(
      e.dispatchCommand({
        type: 'agentDecisionState',
        agentId: logisticsId,
        revision: 0,
        state: 'waiting',
        error: null,
      }).ok,
    ).toBe(false);
  });
  it('private/group @ messages persist, wake their addressees and create bounded decision memory without leaking other private channels', () => {
    const e = quietEngine(),
      mira = e.state.agents.find((a) => a.id === logisticsId)!;
    expect(
      e.dispatchCommand({
        type: 'sendChat',
        channelId: COMMAND_CHANNEL,
        content: '@Mira 请先回基地休息，再考虑运输。',
        mentions: [],
      }).ok,
    ).toBe(true);
    expect(e.state.chatMessages[0].mentions).toEqual([logisticsId]);
    expect(mira.decision.pendingReasons.some((r) => r.startsWith('chat:'))).toBe(true);
    expect(
      e.dispatchCommand({
        type: 'sendChat',
        channelId: privateChannel(battleId),
        content: '战术私聊保密内容',
        mentions: [],
      }).ok,
    ).toBe(true);
    expect(
      e
        .controllerPort(logisticsId)
        .getObservation()!
        .recentChat.some((m) => m.content.includes('保密内容')),
    ).toBe(false);
    for (let i = 0; i < 80; i++)
      appendChat(e, 'commander', privateChannel(logisticsId), '优先级记忆 ' + i);
    expect(mira.memory.length).toBeLessThanOrEqual(32);
    expect(e.getObservation(logisticsId)!.recentChat).toHaveLength(24);
    const restored = parseSave(JSON.parse(JSON.stringify(e.state)));
    expect(restored.chatMessages).toEqual(e.state.chatMessages);
    expect(restored.agents).toEqual(e.state.agents);
    expect(
      e.dispatchCommand({
        type: 'sendChat',
        channelId: privateChannel(logisticsId),
        content: '@Talia 跨频道越权',
        mentions: [battleId],
      }).ok,
    ).toBe(false);
  });
  it('rejects invalid Action/JSON, impossible coordination and stale decisions atomically', () => {
    const e = quietEngine(),
      before = structuredClone(e.state);
    expect(
      decide(e, logisticsId, {
        action: { type: 'ESCORT', targetId: 'nonexistent' },
        messages: [{ channelId: COMMAND_CHANNEL, content: '不应出现', mentions: [] }],
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    expect(
      decide(e, logisticsId, {
        action: { type: 'RETURN' },
        coordination: { type: 'answerEscort', requestId: 'fake', accept: true },
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    expect(
      e.dispatchCommand(
        {
          type: 'agentDecision',
          agentId: logisticsId,
          revision: 0,
          decision: { ...before.agents[0], action: { type: 'CHEAT' } },
        },
        logisticsId,
      ).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    e.dispatchCommand({ type: 'retryAgent', agentId: logisticsId });
    expect(
      e.dispatchCommand(
        {
          type: 'agentDecision',
          agentId: logisticsId,
          revision: 0,
          decision: { goal: '旧意图', rationale: '过期', action: { type: 'RETURN' } },
        },
        logisticsId,
      ).ok,
    ).toBe(false);
  });
  it('unconfirmed Romulan cannot become an autonomous attack target; career is never a whitelist', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'horizon')!;
    const enemy = makeEnemy('romulan-public-test', 'scout', 'romulan', {
      x: ship.x + 80,
      y: ship.y,
    });
    e.state.enemies.push(enemy);
    updateSensors(e);
    expect(decide(e, battleId, { action: { type: 'ATTACK', targetId: enemy.id } }).ok).toBe(false);
    expect(
      decide(e, logisticsId, { action: { type: 'PATROL', targetId: 'mine', duration: 10 } }).ok,
    ).toBe(true);
    e.state.intel.find((i) => i.id === enemy.id)!.hostile = true;
    expect(decide(e, battleId, { action: { type: 'INTERCEPT', targetId: enemy.id } }).ok).toBe(
      true,
    );
  });
  it('training charges recruitment and tuition, pauses with simulation, graduates and can reassign after loss', () => {
    const e = quietEngine();
    run(e, 120);
    const p = e.state.personnel.find((p) => p.status === 'candidate')!;
    const credits = e.state.resources.credits;
    expect(
      e.dispatchCommand({ type: 'candidate', personnelId: p.id, accept: true, career: 'battle' })
        .ok,
    ).toBe(true);
    expect(e.state.resources.credits).toBe(credits - 150);
    e.dispatchCommand({ type: 'pause', paused: true });
    e.advanceFrame();
    expect(p.training).toBe(0);
    run(e, 45);
    const resumed = new SimulationEngine(parseSave(e.state));
    run(resumed, 45);
    const a = resumed.state.agents.find((a) => a.originPersonnelId === p.id)!;
    expect(a.career).toBe('battle');
    expect(a.assignedShipId).toBeNull();
    expect(
      resumed.dispatchCommand({ type: 'assignAgent', agentId: a.id, shipId: 'verity' }).ok,
    ).toBe(true);
    resumed.hit(resumed.state.ships.find((s) => s.id === 'verity')!, 10000);
    expect(a.assignedShipId).toBeNull();
    expect(a.memory.some((m) => m.summary.includes('永久损失'))).toBe(true);
    expect(() => parseSave(resumed.state)).not.toThrow();
    expect(
      resumed.dispatchCommand({ type: 'assignAgent', agentId: a.id, shipId: 'vigil' }).ok,
    ).toBe(true);
  });
});
describe('Journey Planner and complete cooperative logistics loop', () => {
  it('ignores undiscovered/unconfirmed passages and chooses confirmed shortcuts with public ETA/risk', () => {
    const e = quietEngine(),
      ship = e.state.ships[0],
      h = e.state.wormholes[0];
    const secret = planJourney(e.state, ship, h.exit, 'safe');
    expect(secret.legs.every((l) => l.type === 'warp')).toBe(true);
    h.surveyed = true;
    h.discovered = false;
    expect(planJourney(e.state, ship, h.exit, 'safe').legs.every((l) => l.type === 'warp')).toBe(
      true,
    );
    h.discovered = true;
    const known = planJourney(e.snapshot(), ship, h.exit, 'safe');
    expect(known.legs.some((l) => l.type === 'wormhole')).toBe(true);
    expect(known.eta).toBeLessThan(secret.eta / 2);
    expect(journeyOptions(e.snapshot(), ship, h.exit)).toHaveLength(3);
  });
  it('request → accept/ESCORT → load → Wormhole → unload → chat/XP/relationships, with deterministic mid-transit save', () => {
    const { e, source, freighter, escort } = knownPassageFixture();
    const materials = e.base.stock.materials;
    expect(
      decide(e, logisticsId, {
        coordination: { type: 'requestEscort', agentId: battleId, targetShipId: freighter.id },
      }).ok,
    ).toBe(true);
    const request = e.state.escortRequests[0];
    expect(e.getObservation(battleId)!.recentChat.some((m) => m.mentions.includes(battleId))).toBe(
      true,
    );
    expect(
      decide(e, battleId, {
        action: { type: 'ESCORT', targetId: freighter.id },
        coordination: { type: 'answerEscort', requestId: request.id, accept: true },
      }).ok,
    ).toBe(true);
    const haul: Action = {
      type: 'HAUL',
      sourceId: source.id,
      targetId: 'base',
      cargoKind: 'materials',
      amount: 50,
      route: 'safe',
      repeat: false,
    };
    expect(decide(e, logisticsId, { action: haul }).ok).toBe(true);
    until(
      e,
      () =>
        freighter.current?.journey?.legs[freighter.current.journey.legIndex]?.type === 'wormhole',
    );
    expect(freighter.cargo.materials).toBe(50);
    expect(source.stock.materials).toBe(70);
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    until(e, () => !freighter.current && !escort.current);
    const steps = e.state.tick - restored.state.tick;
    run(restored, steps / 10);
    expect(restored.state).toEqual(e.state);
    expect(e.base.stock.materials).toBe(materials + 50);
    expect(freighter.cargo.materials).toBe(0);
    expect(dist(escort, freighter)).toBeLessThan(60);
    expect(
      e.state.history.some((h) => h.kind === 'wormhole' && h.text.includes(freighter.name)),
    ).toBe(true);
    expect(e.state.agents.find((a) => a.id === logisticsId)!.experience).toBeGreaterThan(0);
    expect(e.state.agents.find((a) => a.id === battleId)!.skills.battle).toBeGreaterThan(55);
    expect(request.status).toBe('completed');
    expect(e.state.agents[0].relationships[logisticsId].trust).toBeGreaterThan(50);
    expect(
      e.state.chatMessages.some(
        (m) => m.origin === 'engine' && m.kind === 'report' && m.content.includes('HAUL 完成'),
      ),
    ).toBe(true);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('a rejection changes relationships and returns the requester to a real decision node', () => {
    const e = quietEngine();
    expect(
      decide(e, logisticsId, {
        coordination: { type: 'requestEscort', agentId: battleId, targetShipId: 'meridian' },
      }).ok,
    ).toBe(true);
    expect(
      decide(e, battleId, {
        rationale: '舰体受损，需要先维修',
        coordination: {
          type: 'answerEscort',
          requestId: e.state.escortRequests[0].id,
          accept: false,
        },
      }).ok,
    ).toBe(true);
    expect(e.state.escortRequests[0].status).toBe('rejected');
    expect(e.state.agents[0].relationships[logisticsId].trust).toBe(50);
    expect(
      e.state.chatMessages.some((m) => m.kind === 'reply' && m.content.includes('拒绝护航')),
    ).toBe(true);
    expect(e.state.agents[1].decision.pendingReasons.some((r) => r.startsWith('request:'))).toBe(
      true,
    );
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current).toBeNull();
  });
  it('MOVE and HAUL share wormhole navigation; repeating shipments earn experience per actual delivery', () => {
    const { e, source, freighter } = knownPassageFixture();
    e.state.upgrades.logistics = 1;
    expect(issue(e, { type: 'MOVE', point: { x: e.base.x, y: e.base.y } }, 'verity').ok).toBe(true);
    run(e, 1);
    expect(
      e.state.ships
        .find((s) => s.id === 'verity')!
        .current?.journey?.legs.some((l) => l.type === 'wormhole'),
    ).toBe(true);
    expect(
      decide(e, logisticsId, {
        action: {
          type: 'HAUL',
          sourceId: source.id,
          targetId: 'base',
          cargoKind: 'materials',
          amount: 20,
          route: 'safe',
          repeat: true,
        },
      }).ok,
    ).toBe(true);
    until(e, () => e.state.agents.find((a) => a.id === logisticsId)!.experience >= 8, 800);
    expect(freighter.current?.action.type).toBe('HAUL');
    expect(
      e.state.chatMessages.filter((m) => m.content.includes('本轮完成')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
