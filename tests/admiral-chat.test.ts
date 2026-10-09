import {askIntent,conversation} from './provider-harness';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quietEngine, issue, run, until } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { makeAgent, registerAgent } from '../src/engine/agents';
import { makeEnemy } from '../src/engine/data';
import { updateSensors } from '../src/engine/sensors';
import { materialize } from '../src/engine/world-generation';
import { appendChat, COMMAND_CHANNEL, privateChannel } from '../src/engine/chat';
import { parseSave } from '../src/engine/saves';
import { SaveStore } from '../electron/persistence';
import { ChatCompletionsClient } from '../electron/agents/client';
import type {ObjectiveProposal,CognitionResponse} from '../src/engine/cognition-protocol';
const semantic=(proposal:ObjectiveProposal,allowWormholes=true):Extract<CognitionResponse,{purpose:'intent'}>['decision']=>({disposition:'propose',proposal,objectiveId:null,allowWormholes,reply:'按完整目标规划。'});
import type { ConnectionConfig } from '../electron/agents/config';

const battle = 'ops-horizon',
  freight = 'ops-meridian';
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function order(
  e: SimulationEngine,
  agentId: string,
  content: string,
  channel = privateChannel(agentId),
  decision?:Extract<CognitionResponse,{purpose:'intent'}>['decision'],
) {
  expect(
    e.dispatchCommand({
      type: 'sendChat',
      channelId: channel,
      content,
      mentions: channel === COMMAND_CHANNEL ? [agentId] : [],
      controlMode: 'direct',
    }).ok,
  ).toBe(true);
  const messageId = [...e.state.chatMessages]
    .reverse()
    .find((m) => m.sender === e.state.commander.id)!.id;
  if(decision&&!e.state.objectives.some(o=>o.messageId===messageId)){const request=e.cognition.prepare(agentId)!;expect(request.purpose).toBe('intent');expect(e.dispatchCommand({type:'cognitionDecision',agentId,requestId:request.requestId,response:{purpose:'intent',decision}},agentId).ok).toBe(true);}
  return e.state.objectives.at(-1)!;
}
function resource(e: SimulationEngine) {
  const sector = materialize(e.state, { q: 0, r: 2 });
  sector.discovered = true;
  for (const system of e.state.systems.filter((s) => s.sectorId === sector.id)) {
    system.discovered = true;
    system.survey = 2;
  }
  for (const body of e.state.bodies.filter((b) =>
    e.state.systems.some((s) => s.id === b.systemId && s.sectorId === sector.id),
  )) {
    body.discovered = true;
    body.survey = 2;
  }
  return e.state.bodies.find(
    (b) =>
      b.kind === 'resource' &&
      e.state.systems.some((s) => s.id === b.systemId && s.sectorId === sector.id),
  )!;
}
describe('Admiral chat becomes scoped real engine commands', () => {
  it('keeps private instructions in bounded observations during group traffic, without leaking to rule operators', () => {
    const e = quietEngine();
    const instruction = appendChat(e, 'commander', privateChannel(battle), '关键私聊目标');
    for (let i = 0; i < 60; i++) appendChat(e, freight, COMMAND_CHANNEL, '航线统计 ' + i);
    expect(e.getObservation(battle)!.recentChat).toHaveLength(24);
    expect(e.getObservation(battle)!.recentChat.some((m) => m.id === instruction.id)).toBe(true);
    expect(e.getObservation('ops-vigil')!.recentChat).toEqual([]);
  });
  it('invalid quantities and unsafe sector coordinates never enter a save or displace a current task', () => {
    const e = quietEngine();
    const active = order(e, battle, '巡逻基地 30 分钟');
    order(e, battle, '巡逻基地 999999 分钟');
    order(e, battle, '沿 0/9999999999999999999999 一路测绘回来直到 0/0');
    order(e, freight, '从 mine 运送 999999999999 Materials 到 base');
    expect(active.status).toBe('active');
    expect(e.state.objectives).toHaveLength(1);
    expect(e.state.chatMessages.some((m) => m.content.includes('参数超出'))).toBe(true);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('attacks a real unconfirmed contact under RETURN FIRE without changing hostility; awards executor XP', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'horizon')!;
    const target = makeEnemy('orion-scout', 'scout', 'orion', { x: ship.x + 80, y: ship.y });
    target.weapons = 0;
    target.nextDecision = 10000;
    e.state.enemies.push(target);
    updateSensors(e);
    expect(e.state.intel.find((i) => i.id === target.id)!.hostile).toBe(false);
    expect(e.submitAction(battle, { type: 'ATTACK', targetId: target.id }).ok).toBe(false);
    const task = order(e,battle,'去把 orion scout 干掉，立即开火！',privateChannel(battle),semantic({kind:'engage',targetIds:[target.id]}));
    expect(ship.current).toMatchObject({
      source: 'admiral',
      actorId: 'commander',
      executorAgentId: battle,
      sourceMessageId: task.messageId,
      action: { type: 'ATTACK', targetId: target.id },
    });
    expect(ship.standing.roe).toBe('RETURN FIRE');
    expect(e.state.intel.find((i) => i.id === target.id)!.hostile).toBe(false);
    until(e, () => task.status === 'completed');
    expect(target.hull).toBe(0);
    expect(e.state.agents.find((a) => a.id === battle)!.experience).toBeGreaterThan(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('resolves follow-up fire against the same target and rejects forged or cross-private grants', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'horizon')!;
    const target = makeEnemy('orion-scout', 'scout', 'orion', { x: ship.x + 100, y: ship.y });
    e.state.enemies.push(target);
    updateSensors(e);
    order(e, battle, '攻击 orion-scout');
    const task = order(e,battle,'直接开火。实时跟踪其位置！',privateChannel(battle),{disposition:'continue',proposal:null,objectiveId:e.state.objectives.at(-1)!.id,allowWormholes:true,reply:'继续已授权的完整交战目标。'});
    expect(ship.current?.action).toEqual({ type: 'ATTACK', targetId: target.id });
    expect(
      e.dispatchCommand({ type: 'interpretInteraction', agentId: freight, messageId: task.messageId })
        .ok,
    ).toBe(false);
    expect(
      e.dispatchCommand(
        { type: 'interpretInteraction', agentId: battle, messageId: task.messageId },
        battle,
      ).ok,
    ).toBe(false);
    expect(
      e.dispatchCommand({ type: 'interpretInteraction', agentId: battle, messageId: 99999 }).ok,
    ).toBe(false);
  });
  it('group @ allocation really changes Assignment and refuses to displace another Agent', () => {
    const e = quietEngine();
    const cadet = makeAgent('cadet', 'Cadet 5', 'battle');
    registerAgent(e.state, cadet);
    const assigned = order(e, cadet.id, '@Cadet 5 USS VIGIL 给你了', COMMAND_CHANNEL);
    expect(assigned.status).toBe('completed');
    expect(cadet.assignedShipId).toBe('vigil');
    expect(e.state.assignments.find((a) => a.operatorId === cadet.id)?.shipId).toBe('vigil');
    const other = order(e, freight, 'USS VIGIL 给你了');
    expect(other.status).toBe('blocked');
    expect(cadet.assignedShipId).toBe('vigil');
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('creates and funds one mine, requests real Logistics assistance, transports and builds it', () => {
    const e = quietEngine(),
      body = resource(e);
    expect(body).toBeDefined();
    const cadet = makeAgent('cadet', 'Cadet 5', 'battle');
    registerAgent(e.state, cadet);
    order(e, cadet.id, 'USS VIGIL 给你了');
    const beforeCredits = e.state.resources.credits;
    const beforeStock = e.state.locations.reduce((sum, l) => sum + l.stock.materials, 0);
    const extracted = e.state.locations.reduce((sum, l) => sum + l.extracted, 0);
    const task = order(e,cadet.id,'你去建设好'+body.name,privateChannel(cadet.id),semantic({kind:'construction',siteId:body.id,facilityKind:'mine'}));
    expect(e.state.resources.credits).toBe(beforeCredits - 165);
    const request = e.state.escortRequests.find((r) => r.parentTaskId === task.id)!;
    expect(request.status).toBe('pending');
    const ticket=e.cognition.prepare(freight)!;
    expect(e.dispatchCommand({type:'cognitionDecision',agentId:freight,requestId:ticket.requestId,response:{purpose:'collaboration',decision:{requestId:request.id,version:1,response:'accept',conditions:[],reason:'preference',reply:'愿意支援建设物资运输。'}}},freight).ok).toBe(true);
    run(e, 1);
    expect(e.state.ships.find((s) => s.id === 'meridian')?.current?.action.type).toBe('HAUL');
    run(e, 25);
    const resumed = new SimulationEngine(parseSave(e.state));
    until(
      resumed,
      () => resumed.state.objectives.find((t) => t.id === task.id)?.status === 'completed',
      600,
    );
    const mine = resumed.state.locations.find((l) => l.siteId === body.id && l.kind === 'mine');
    expect(mine).toBeDefined();
    expect(resumed.state.projects.filter((p) => p.siteId === body.id)).toHaveLength(1);
    expect(
      resumed.state.history.some((h) => h.kind === 'cargo' && h.text.includes('装载 30')),
    ).toBe(true);
    const production = resumed.state.locations.reduce((sum, l) => sum + l.extracted, 0) - extracted;
    expect(resumed.state.locations.reduce((sum, l) => sum + l.stock.materials, 0)).toBeCloseTo(
      beforeStock + production - 30,
      5,
    );
    expect(resumed.state.agents.find((a) => a.id === freight)!.experience).toBeGreaterThan(0);
    expect(
      resumed.state.chatMessages.some((m) => m.kind === 'request' && m.mentions.includes(freight)),
    ).toBe(true);
    expect(() => parseSave(resumed.state)).not.toThrow();
  });
  it('surveys consecutive sectors without using a confirmed shortcut; resumes deterministically and can be cancelled', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'horizon')!;
    const h = e.state.wormholes.find((h) => h.id === 'wormhole:0:0')!;
    h.surveyed = true;
    h.stable = true;
    h.stability = 1;
    const sector = materialize(e.state, { q: 0, r: 2 });
    sector.discovered = true;
    ship.x = 0;
    ship.y = 800;
    const task = order(e,battle,'沿 0/2、0/1 一路测绘回来直到 0/0，不走虫洞',privateChannel(battle),semantic({kind:'surveyRoute',sectors:[{q:0,r:2},{q:0,r:1},{q:0,r:0}]},false));
    expect(task.sectors).toEqual([
      { q: 0, r: 2 },
      { q: 0, r: 1 },
      { q: 0, r: 0 },
    ]);
    run(e, 5);
    expect(ship.current?.allowWormholes).toBe(false);
    expect(ship.current?.journey?.legs.every((l) => l.type === 'warp') ?? true).toBe(true);
    const restored = new SimulationEngine(parseSave(e.state));
    run(e, 20);
    run(restored, 20);
    expect(restored.state).toEqual(e.state);
    until(e, () => task.status === 'completed', 600);
    for (const coord of task.sectors) {
      const sec = e.state.sectors.find((s) => s.q === coord.q && s.r === coord.r)!;
      expect(
        e.state.systems.filter((s) => s.sectorId === sec.id).every((s) => s.survey === 2),
      ).toBe(true);
    }
    const next = order(e,battle,'沿 0/0 一路测绘回来直到 0/2，不走虫洞',privateChannel(battle),semantic({kind:'surveyRoute',sectors:[{q:0,r:0},{q:0,r:1},{q:0,r:2}]},false));
    issue(e, { type: 'MOVE', point: { x: -240, y: 0 } }, ship.id);
    expect(next.status).toBe('interrupted');
    expect(ship.current?.objectiveId).not.toBe(next.id);
    run(e, 10);
    expect(next.status).toBe('interrupted');
  });
  it('acknowledgements persist with reply links but do not wake peers into a feedback loop', () => {
    const e = quietEngine();
    const source = appendChat(e, freight, COMMAND_CHANNEL, '@Talia 航线安全', [battle]);
    const agent = e.state.agents.find((a) => a.id === freight)!;
    const revision = agent.decision.revision;
    appendChat(e, battle, COMMAND_CHANNEL, '@Mira 收到', [freight], 'message', {
      purpose: 'acknowledgement',
      replyTo: source.id,
    });
    expect(agent.decision.revision).toBe(revision);
    expect(parseSave(e.state).chatMessages.at(-1)?.replyTo).toBe(source.id);
  });
  it('questions grant no authority, model claims cannot allocate ships, and direct group control stops task progression', () => {
    const e = quietEngine();
    order(e, battle, '为什么要建设矿场？');
    expect(e.state.objectives).toEqual([]);
    const cadet = makeAgent('cadet', 'Cadet 5', 'battle');
    registerAgent(e.state, cadet);
    const before = structuredClone(e.state);
    expect(
      e.dispatchCommand(
        {
          type: 'agentDecision',
          agentId: cadet.id,
          revision: 0,
          decision: {
            goal: '巡逻',
            rationale: '等待分配',
            action: null,
            messages: [
              { channelId: privateChannel(cadet.id), content: '已接领 USS VIGIL', mentions: [] },
            ],
          },
        },
        cadet.id,
      ).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    const task = order(e,battle,'沿 0/0 一路测绘到 0/2，不走虫洞',privateChannel(battle),semantic({kind:'surveyRoute',sectors:[{q:0,r:0},{q:0,r:1},{q:0,r:2}]},false));
    const ship = e.state.ships.find((s) => s.id === 'horizon')!;
    const tampered = structuredClone(e.state);
    tampered.ships.find((s) => s.id === ship.id)!.current!.allowWormholes = true;
    expect(() => parseSave(tampered)).toThrow();
    expect(
      e.dispatchCommand({
        type: 'createGroup',
        name: 'CONTROL',
        shipIds: ['horizon'],
        flagshipId: 'horizon',
        spacing: 30,
      }).ok,
    ).toBe(true);
    expect(
      e.dispatchCommand({
        type: 'issueGroupDirective',
        groupId: e.state.groups[0].id,
        mode: 'REPLACE',
        action: { type: 'RETURN' },
      }).ok,
    ).toBe(true);
    expect(task.status).toBe('interrupted');
    expect(ship.current?.action.type).toBe('RETURN');
    run(e, 2);
    expect(task.status).toBe('interrupted');
  });
  it('QUEUE preserves the current complete objective before the next direct operation', () => {
    const e = quietEngine();
    const task = order(e,freight,'从 mine 运送 10 Materials 到 base',privateChannel(freight),semantic({kind:'transport',sourceId:'mine',destinationId:'base',cargoKind:'materials',amount:10,repeat:false,route:'safe'}));
    const ship = e.state.ships.find((s) => s.id === 'meridian')!;
    const currentId = ship.current!.id;
    issue(e, { type: 'RETURN' }, ship.id, 'QUEUE');
    expect(task.status).toBe('active');
    expect(ship.current!.id).toBe(currentId);
    expect(ship.queue[0].action.type).toBe('RETURN');
    until(e, () => !ship.current && !ship.queue.length);
    expect(e.state.history.some((h) => h.kind === 'cargo' && h.text.includes('实际交付 10'))).toBe(
      true,
    );
    expect(() => parseSave(e.state)).not.toThrow();
  });
});

const config: ConnectionConfig = {
  baseUrl: 'https://fixture.invalid/v1',
  defaultModel: 'model',
  reasoningEffort: 'none',
  apiKey: 'private-fixture-key',
};
const response = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }));
describe('Schema constraints and bounded repairs', () => {
  it('sends the derived strict schema and repairs missing fields using diagnostic paths', async () => {
    const requests: Record<string, unknown>[] = [];
    const client = new ChatCompletionsClient(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      return response(
        requests.length === 1
          ? JSON.stringify({disposition:'propose',proposal:{kind:'survey',targetId:'fake'},allowWormholes:true,reply:'需测绘'})
          : JSON.stringify(conversation('没有明确任务')),
      );
    });
    const decision = await askIntent(client, config, quietEngine().getObservation(battle)!);
    expect(decision.proposal).toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests[0].response_format).toMatchObject({
      type: 'json_object',
    });
    expect(JSON.stringify(requests[1])).toContain('proposal');
    expect(JSON.stringify(requests)).not.toContain(config.apiKey);
  });
  it('caches schema→JSON→text fallback and never sends reasoning for none', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new ChatCompletionsClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.response_format) return new Response('response_format unsupported', { status: 400 });
      return response(JSON.stringify(conversation('已有任务')));
    });
    const obs = quietEngine().getObservation(battle)!;
    await askIntent(client, config, obs);
    await askIntent(client, config, obs);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty('response_format');
    expect(bodies.every((b) => !('reasoning_effort' in b))).toBe(true);
  });
  it('does not send semantic or authorization rejection back to the model for repair',async()=>{
    const e=quietEngine();e.dispatchCommand({type:'sendChat',channelId:privateChannel(battle),content:'按完整目标执行这个地点的巡逻。',mentions:[]});
    const request=e.cognition.prepare(battle)!,before=structuredClone(e.state.ships);let calls=0;
    const client=new ChatCompletionsClient(async()=>{calls++;return response(JSON.stringify({disposition:'propose',proposal:{kind:'patrol',targetId:'invented',duration:10},objectiveId:null,allowWormholes:true,reply:'计划巡逻'}));});
    const result=await client.cognize(config,request,e.state.agents.find(a=>a.id===battle)!.modelConfig,new AbortController().signal);
    expect(e.dispatchCommand({type:'cognitionDecision',agentId:battle,requestId:request.requestId,response:result},battle).ok).toBe(false);expect(calls).toBe(1);expect(e.state.ships).toEqual(before);expect(e.state.objectives).toHaveLength(0);
    const invalid=new ChatCompletionsClient(async()=>response('{"disposition":"propose","proposal":{"kind":"CHEAT"},"allowWormholes":true,"reply":"x"}'));
    await expect(askIntent(invalid,config,e.getObservation(battle)!)).rejects.toThrow(/格式|JSON/);expect(e.state.ships).toEqual(before);
  });
});
describe('v14 starts an independent world and preserves historical chat files', () => {
  it('does not import or replay old commands and leaves older branch bytes unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-v14-isolation-'));
    directories.push(dir);
    const old = readFileSync('demo/agent-demo-v11.json', 'utf8');
    const root = join(dir, 'frontiers-v11', 'frontier-000001');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'head.json'), old);
    const index = JSON.stringify({
      version: 11,
      activeId: 'frontier-000001',
      branches: [{ id: 'frontier-000001', parent: null }],
    });
    writeFileSync(join(dir, 'timeline-v11.json'), index);
    const store = new SaveStore(dir);
    expect(store.read().world).toBeNull();
    expect(store.read().blocked).toBe(false);
    store.write(quietEngine().state);
    expect(store.read().world?.version).toBe(16);
    expect(store.read().world?.objectives).toEqual([]);
    expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(old);
    expect(readFileSync(join(dir, 'timeline-v11.json'), 'utf8')).toBe(index);
  });
});
