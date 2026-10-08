import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { quietEngine, issue, run, until } from './helpers';
import { makeEnemy } from '../src/engine/data';
import { updateSensors } from '../src/engine/sensors';
import { compileAdmiralIntent } from '../src/engine/admiral-intent';
import { privateChannel } from '../src/engine/chat';
import { parseSave } from '../src/engine/saves';
import { SimulationEngine } from '../src/engine/engine';
import { SaveStore } from '../electron/persistence';
import { AgentDecisionService } from '../electron/agents/service';
import { ChatCompletionsClient } from '../electron/agents/client';
import { RequestTracker } from '../electron/agents/runtime';
import { haulLoad } from '../src/engine/inventory';
import { workWillingness } from '../src/engine/personality';
import { destroyShip } from '../src/engine/combat';
const battle = 'ops-horizon',
  freight = 'ops-meridian';
const config = {
  baseUrl: 'http://127.0.0.1/v1',
  defaultModel: 'isolated',
  reasoningEffort: 'none' as const,
  apiKey: 'isolated-only',
};
const response = (value: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise<void>((done) => setImmediate(done));
};
function service(e: SimulationEngine, client: ChatCompletionsClient) {
  return new AgentDecisionService(
    {
      snapshot: () => e.snapshot(),
      controllerPort: (id) => e.controllerPort(id),
      command: (c, id) => e.dispatchCommand(c, id),
      validate: (c, id) => e.validate(c, id),
    },
    () => config,
    client,
  );
}
function send(
  e: SimulationEngine,
  id: string,
  content: string,
  mode: 'direct' | 'voluntary' = 'direct',
) {
  expect(
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(id),
      content,
      mentions: [],
      controlMode: mode,
    }).ok,
  ).toBe(true);
  const message = [...e.state.chatMessages]
    .reverse()
    .find((m) => m.sender === e.state.commander.id)!;
  expect(
    e.dispatchCommand({ type: 'admiralChatTask', agentId: id, messageId: message.id }).ok,
  ).toBe(true);
  return message;
}
function targets(e: SimulationEngine) {
  const ship = e.state.ships.find((s) => s.id === 'horizon')!;
  ship.x = 0;
  ship.y = 0;
  for (const [id, x] of [
    ['orion-test-a', 50],
    ['orion-test-b', 80],
  ] as const) {
    const enemy = makeEnemy(id, 'raider', 'orion', { x, y: 0 });
    enemy.weapons = 0;
    enemy.engines = 0;
    enemy.nextDecision = 10000;
    e.state.enemies.push(enemy);
  }
  updateSensors(e);
  run(e, 4);
}
describe('v15 actual commands and feedback', () => {
  it('the exact original message becomes a short judged persistent attack under RETURN FIRE', async () => {
    const e = quietEngine();
    targets(e);
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(battle),
      content: '去摧毁所有的orion',
      mentions: [],
    });
    const bodies: string[] = [];
    const svc = service(
      e,
      new ChatCompletionsClient(async (_url, init) => {
        bodies.push(String(init?.body));
        return response({
          accept: true,
          reason: 'preference',
          rationale: '舰况允许',
          reply: '我会持续清剿已知 Orion，确认战果后继续。',
        });
      }),
    );
    svc.pump();
    await flush();
    expect(bodies).toHaveLength(1);
    expect(Buffer.byteLength(bodies[0])).toBeLessThan(12000);
    expect(bodies[0]).toContain('TASK_JUDGMENT:');
    expect(bodies[0]).not.toContain('完整 JSON Schema');
    const task = e.state.admiralTasks[0];
    expect(task.kind).toBe('factionAssault');
    expect({
      task,
      decision: e.state.agents.find((a) => a.id === battle)!.decision,
      current: e.state.ships.find((s) => s.id === 'horizon')!.current,
    }).toMatchObject({
      task: { consent: 'accepted', status: 'active' },
      current: { action: { type: 'ATTACK' } },
    });
    expect(
      e.state.chatMessages.some(
        (m) =>
          m.channelId === privateChannel(battle) &&
          m.origin === 'agent' &&
          m.replyTo === task.messageId,
      ),
    ).toBe(true);
    until(e, () => e.state.enemies.length === 0, 120);
    run(e, 1);
    expect(task.status).toBe('blocked');
    expect(e.state.chatMessages.some((m) => m.content.includes('实际开火'))).toBe(true);
    const enemy = makeEnemy('orion-test-new', 'raider', 'orion', { x: 40, y: 0 });
    enemy.weapons = 0;
    enemy.engines = 0;
    enemy.nextDecision = 10000;
    e.state.enemies.push(enemy);
    updateSensors(e);
    until(e, () => !e.state.enemies.length, 120);
    expect(task.status).not.toBe('completed');
    expect(() => parseSave(e.state)).not.toThrow();
    svc.dispose();
  });
  it('an ordered target set fires at and confirms both targets, survives restart, and can be replaced', () => {
    const e = quietEngine();
    targets(e);
    const ids = e.state.enemies.map((s) => s.id);
    expect(issue(e, { type: 'ATTACK_SET', targetIds: ids }, 'horizon')).toMatchObject({ ok: true });
    run(e, 1);
    const restored = new SimulationEngine(parseSave(e.state));
    run(e, 3);
    run(restored, 3);
    expect(restored.state).toEqual(e.state);
    until(e, () => !e.state.ships.find((s) => s.id === 'horizon')!.current, 120);
    expect(e.state.enemies).toHaveLength(0);
    for (const id of ids)
      expect(e.state.history.some((h) => h.kind === 'factionLoss' && h.entityId === id)).toBe(true);
    expect(issue(e, { type: 'RETURN' }, 'horizon').ok).toBe(true);
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current?.action.type).toBe('RETURN');
  });
  it('a structured button request is judged and replaces existing work without punitive mood changes', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    issue(e, { type: 'REST', targetId: 'base', duration: 60 }, 'horizon');
    const a = e.state.agents.find((a) => a.id === battle)!;
    const mood = { trust: a.trust, resentment: a.psychology.resentment };
    expect(
      e.dispatchCommand({
        type: 'proposeDirective',
        shipIds: ['horizon'],
        mode: 'REPLACE',
        action: { type: 'PATROL', targetId: 'base', duration: 60 },
      }).ok,
    ).toBe(true);
    const svc = service(
      e,
      new ChatCompletionsClient(async () =>
        response({
          accept: true,
          reason: 'preference',
          rationale: '可以改变计划',
          reply: '改为巡逻基地。',
        }),
      ),
    );
    svc.pump();
    await flush();
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current?.action.type).toBe('PATROL');
    expect(a.trust).toBe(mood.trust);
    expect(a.psychology.resentment).toBe(mood.resentment);
    svc.dispose();
  });
  it('fills a 600 hold and amends an underway 50-material delivery without losing its manifest', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'meridian')!,
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    mine.capacity.materials = 2000;
    mine.stock.materials = 1000;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 50,
        route: 'safe',
        repeat: false,
      },
      ship.id,
    );
    until(e, () => ship.cargo.materials === 50);
    run(e, 1);
    const m = send(e, freight, '运输直接装满货仓，立即执行！');
    expect(e.state.chatMessages.some((r) => r.id > m.id && r.content.includes('请明确货物'))).toBe(
      false,
    );
    expect(ship.current?.action).toMatchObject({
      type: 'HAUL',
      sourceId: 'mine',
      targetId: 'base',
      loadPolicy: 'auto',
    });
    expect(ship.current?.carried).toBe(50);
    until(e, () => ship.cargo.materials === 600, 180);
    expect(ship.current?.carried).toBe(600);
    expect(() => parseSave(e.state)).not.toThrow();
    const baseBefore = e.base.stock.materials;
    until(e, () => !ship.current, 180);
    expect(ship.cargo.materials).toBe(0);
    expect(e.base.stock.materials).toBeCloseTo(baseBefore + 600, 4);
  });
  it('automatic projection has no artificial 50 cap while an explicit 50 remains fixed', () => {
    const e = quietEngine(),
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    mine.stock.materials = 1000;
    mine.capacity.materials = 2000;
    const o = e.getObservation(freight)!;
    expect(
      o.actionExamples.find(
        (a) =>
          a.type === 'HAUL' &&
          a.sourceId === 'mine' &&
          a.targetId === 'base' &&
          a.cargoKind === 'materials',
      ),
    ).toMatchObject({ amount: 600, loadPolicy: 'auto' });
    expect(
      compileAdmiralIntent(o, { content: '从 mine 运送 50 材料到 base' }).intent?.action,
    ).toMatchObject({ amount: 50, loadPolicy: 'fixed' });
  });
  it('an amendment inherits the real route and cargo while explicit new parameters override it', () => {
    const e = quietEngine();
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'quantum',
        amount: 50,
        route: 'risky',
        repeat: false,
      },
      'meridian',
    );
    const o = e.getObservation(freight)!;
    expect(
      compileAdmiralIntent(o, { content: '运输直接装满货仓，立即执行' }).intent?.action,
    ).toMatchObject({
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'quantum',
      route: 'risky',
      loadPolicy: 'auto',
    });
    expect(
      compileAdmiralIntent(o, { content: '从base运输50光子到mine，走安全路线' }).intent?.action,
    ).toMatchObject({
      sourceId: 'base',
      targetId: 'mine',
      cargoKind: 'photon',
      amount: 50,
      route: 'safe',
      loadPolicy: 'fixed',
    });
    expect(compileAdmiralIntent(o, { content: '从未知地点运输到基地' }).clarification).toBeTruthy();
  });
  it('queued cargo cannot copy the current manifest and an immediate smaller order preserves the leftover goods', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'meridian')!;
    const action = {
      type: 'HAUL' as const,
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'materials' as const,
      amount: 50,
      route: 'safe' as const,
      repeat: false,
    };
    issue(e, action, s.id);
    until(e, () => s.cargo.materials === 50);
    issue(e, action, s.id, 'QUEUE');
    expect(s.queue[0].carried).toBe(0);
    expect(
      e.dispatchCommand({
        type: 'modifyCurrentTask',
        shipId: s.id,
        action: { ...action, amount: 20 },
      }).ok,
    ).toBe(true);
    expect(s.current?.carried).toBe(20);
    expect(s.queue).toHaveLength(0);
    until(e, () => !s.current, 180);
    expect(s.cargo.materials).toBe(30);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('unseen destruction remains unconfirmed until actual wreck observation', () => {
    const e = quietEngine();
    targets(e);
    const target = e.state.enemies[0],
      record = e.state.intel.find((i) => i.id === target.id)!;
    target.x = 2000;
    target.y = 2000;
    updateSensors(e);
    expect(record.live).toBe(false);
    destroyShip(e, target, 'hidden test encounter');
    expect(record.resolved).toBe(false);
    expect(e.snapshot().contacts.some((i) => i.id === target.id)).toBe(true);
    const observer = e.state.ships.find((s) => s.id === 'verity')!;
    observer.x = 2000;
    observer.y = 2000;
    updateSensors(e);
    expect(record.resolved).toBe(true);
    expect(e.state.history.some((h) => h.kind === 'factionLoss' && h.entityId === target.id)).toBe(
      true,
    );
  });
  it('a long original player message stays complete in both compact initial and repaired requests', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    const content = '报告当前情况。' + '这'.repeat(1190);
    expect(
      e.dispatchCommand({
        type: 'sendChat',
        channelId: privateChannel(battle),
        content,
        mentions: [],
      }).ok,
    ).toBe(true);
    let calls = 0;
    const bodies: string[] = [];
    const svc = service(
      e,
      new ChatCompletionsClient(async (_url, init) => {
        calls++;
        bodies.push(String(init?.body));
        return response(
          calls === 1 ? { bad: true } : { goal: '等待', rationale: '当前没有新目标', action: null },
        );
      }),
    );
    svc.pump();
    await flush();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(Buffer.byteLength(body)).toBeLessThan(12000);
      expect(
        JSON.parse(JSON.parse(body).messages[1].content).recentChat.some(
          (m: { content: string }) => m.content === content,
        ),
      ).toBe(true);
    }
    svc.dispose();
  });
  it.each([
    { occupied: 100, stock: 1000, space: 1000, load: 500 },
    { occupied: 0, stock: 120, space: 1000, load: 120 },
    { occupied: 0, stock: 1000, space: 75, load: 75 },
    { occupied: 0, stock: 1000, space: 0, load: 0 },
  ])(
    'automatic loading respects occupied space, real stock and destination capacity: %j',
    ({ occupied, stock, space, load }) => {
      const e = quietEngine(),
        s = e.state.ships.find((s) => s.id === 'meridian')!,
        source = e.state.locations.find((l) => l.id === 'mine')!;
      s.cargo.photon = occupied;
      s.x = source.x;
      s.y = source.y;
      source.stock.materials = stock;
      e.base.stock.materials = e.base.capacity.materials - space;
      const action = {
        type: 'HAUL' as const,
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials' as const,
        amount: 10000,
        loadPolicy: 'auto' as const,
        route: 'safe' as const,
        repeat: false,
      };
      expect(haulLoad(e.state, s, action)).toBe(load);
      expect(issue(e, action, s.id).ok).toBe(true);
      if (load) {
        until(e, () => s.cargo.materials === load, 4);
        expect(s.current?.carried).toBe(load);
      } else {
        run(e, 4);
        expect(s.cargo.materials).toBe(0);
      }
      expect(() => parseSave(e.state)).not.toThrow();
    },
  );
  it('automatic construction loading is limited by actual unmet demand and other inbound cargo', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'meridian')!;
    e.state.locations.find((l) => l.id === 'mine')!.stock.materials = 1000;
    const site = e.state.bodies.find((b) => b.discovered && b.kind === 'resource')!;
    site.survey = 2;
    expect(
      e.dispatchCommand({
        type: 'startConstruction',
        siteId: site.id,
        kind: 'outpost',
        name: '隔离测试前哨',
      }),
    ).toMatchObject({ ok: true });
    const p = e.state.projects.at(-1)!;
    p.stock.materials = p.cost.materials - 12;
    const action = {
      type: 'HAUL' as const,
      sourceId: 'mine',
      targetId: p.id,
      cargoKind: 'materials' as const,
      amount: 10000,
      loadPolicy: 'auto' as const,
      route: 'safe' as const,
      repeat: false,
    };
    expect(haulLoad(e.state, s, action)).toBe(12);
    expect(issue(e, { ...action, amount: 7, loadPolicy: 'fixed' }, 'vigil').ok).toBe(true);
    const other = e.state.ships.find((s) => s.id === 'vigil')!;
    other.current!.carried = 7;
    other.cargo.materials = 7;
    expect(haulLoad(e.state, s, action)).toBe(5);
  });
  it('each automatic repeat trip recalculates available stock and warehouse space', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'meridian')!,
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    e.state.upgrades.logistics = 1;
    mine.stock.materials = 1000;
    s.x = mine.x;
    s.y = mine.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 10000,
        loadPolicy: 'auto',
        route: 'safe',
        repeat: true,
      },
      s.id,
    );
    until(e, () => s.current!.cycle === 1, 180);
    mine.stock.materials = 110;
    e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
    until(e, () => s.current?.phase === 'delivering' && s.current.cycle === 1, 180);
    expect(s.current?.carried).toBe(110);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('fatigue uses real activity in direct control, rests promptly and freezes when paused', () => {
    const e = quietEngine(),
      a = e.state.agents.find((a) => a.id === battle)!;
    issue(e, { type: 'PATROL', targetId: 'base', duration: 60 }, 'horizon');
    run(e, 30);
    expect(a.fatigue).toBeCloseTo(7.5, 5);
    a.fatigue = 70;
    issue(e, { type: 'REST', targetId: 'base', duration: 100 }, 'horizon');
    until(e, () => e.state.ships.find((s) => s.id === 'horizon')!.status === 'docked');
    const before = a.fatigue;
    run(e, 30);
    expect(before - a.fatigue).toBeCloseTo(22.5, 5);
    e.state.paused = true;
    const state = structuredClone(a);
    for (let i = 0; i < 20; i++) e.advanceFrame();
    expect(a).toEqual(state);
  });
  it('real shield/hull hits change stress once per episode and survive reload without replay', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'horizon')!,
      a = e.state.agents.find((a) => a.id === battle)!;
    e.hit(ship, 1);
    expect(a.psychology.stress).toBe(8);
    e.hit(ship, 1);
    expect(a.psychology.stress).toBe(8);
    e.hit(ship, ship.shield + ship.hull * 0.3);
    expect(a.psychology.stress).toBe(13);
    expect(a.psychology.confidence).toBe(57);
    const restored = new SimulationEngine(parseSave(e.state));
    restored.hit(restored.state.ships.find((s) => s.id === ship.id)!, 1);
    expect(restored.state.agents.find((a) => a.id === battle)!.psychology.stress).toBe(13);
  });
  it('equal elapsed game time at all speeds produces equal state dynamics', () => {
    const states = [1, 4, 16].map((speed) => {
      const e = quietEngine();
      issue(e, { type: 'PATROL', targetId: 'base', duration: 100 }, 'horizon');
      e.state.speed = speed as 1 | 4 | 16;
      e.state.paused = false;
      for (let i = 0; i < 480 / speed; i++) e.advanceFrame();
      return e.state.agents.find((a) => a.id === battle)!;
    });
    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
  });
  it('sustained real fire increases fatigue and stress, and overwork changes later willingness', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'horizon')!,
      a = e.state.agents.find((a) => a.id === battle)!,
      base = e.state.locations.find((l) => l.owner === 'orion')!;
    base.discovered = true;
    base.maxHull = base.hull = 20000;
    base.maxShield = base.shield = 0;
    base.cooldown = 1e9;
    s.x = base.x - 45;
    s.y = base.y;
    s.photon = 0;
    s.quantum = 0;
    issue(e, { type: 'ATTACK', targetId: base.id }, s.id);
    run(e, 30);
    expect(base.hull).toBeLessThan(20000);
    expect(a.fatigue).toBeCloseTo(15, 0);
    expect(a.psychology.stress).toBeGreaterThan(8);
    const ready = workWillingness(a);
    a.fatigue = 85;
    issue(e, { type: 'PATROL', targetId: 'base', duration: 100 }, s.id);
    const resentment = a.psychology.resentment;
    run(e, 30);
    expect(a.psychology.resentment - resentment).toBeCloseTo(3, 2);
    expect(workWillingness(a)).toBeLessThan(ready);
    const events = a.decision.events.filter((v) => v.id === 'state:fatigue80');
    expect(events).toHaveLength(1);
  });
  it('waiting safely for stock is idle and a disabled or unconfigured Agent still answers every addressed message', async () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'meridian')!,
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    s.x = mine.x;
    s.y = mine.y;
    mine.stock.materials = 0;
    e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
    const a = e.state.agents.find((a) => a.id === freight)!;
    a.fatigue = 30;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 10000,
        loadPolicy: 'auto',
        route: 'safe',
        repeat: false,
      },
      s.id,
    );
    run(e, 30);
    expect(a.fatigue).toBeCloseTo(22.5, 4);
    a.enabled = false;
    const svc = service(
      e,
      new ChatCompletionsClient(async () => {
        throw Error('must not call');
      }),
    );
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(freight),
      content: '请报告情况',
      mentions: [],
    });
    svc.pump();
    expect(
      [...e.state.chatMessages].reverse().find((m) => m.sender === 'commander')!.responses?.[
        freight
      ],
    ).toBe('failed');
    svc.dispose();
  });
  it('normal chat stays compact, has a same-channel reply and records timing without secrets', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    let body = '';
    const tracker = new RequestTracker();
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(battle),
      content: '现在情况如何？',
      mentions: [],
    });
    const msg = [...e.state.chatMessages].reverse().find((m) => m.sender === e.state.commander.id)!;
    const svc = service(
      e,
      new ChatCompletionsClient(async (_url, init) => {
        body = String(init?.body);
        return response({ goal: '等待', rationale: '目前舰况良好', action: null });
      }, tracker),
    );
    svc.pump();
    await flush();
    expect(Buffer.byteLength(body)).toBeLessThan(12000);
    expect(msg.responses?.[battle]).toBe('replied');
    expect(
      e.state.chatMessages.some(
        (m) => m.origin === 'agent' && m.replyTo === msg.id && m.channelId === msg.channelId,
      ),
    ).toBe(true);
    expect(tracker.stats().recentRequests[0]).toMatchObject({
      phase: 'completed',
      requestBytes: Buffer.byteLength(body),
    });
    expect(JSON.stringify(tracker.stats())).not.toContain(config.apiKey);
    svc.dispose();
  });
  it('state changes merge behind a player reply and trigger one subsequent decision during direct work', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    const a = e.state.agents.find((a) => a.id === battle)!;
    a.fatigue = 49.9;
    issue(e, { type: 'PATROL', targetId: 'base', duration: 100 }, 'horizon');
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(battle),
      content: '请报告状态',
      mentions: [],
    });
    let calls = 0;
    let release: () => void = () => {};
    const bodies: string[] = [];
    const svc = service(
      e,
      new ChatCompletionsClient(async (_url, init) => {
        calls++;
        bodies.push(String(init?.body));
        if (calls === 1) await new Promise<void>((done) => (release = done));
        return response({
          goal: '继续巡逻并关注疲劳',
          rationale: '按真实状态重新判断',
          action: null,
        });
      }),
    );
    svc.pump();
    await flush();
    const revision = a.decision.revision;
    run(e, 2);
    svc.pump();
    expect(calls).toBe(1);
    expect(a.decision.revision).toBe(revision);
    release();
    await flush();
    svc.pump();
    await flush();
    expect(calls).toBe(2);
    const second = JSON.parse(JSON.parse(bodies[1]).messages[1].content);
    expect(second.self.fatigue).toBeGreaterThan(50);
    expect(second.self.decision.events.some((v: { kind: string }) => v.kind === 'state')).toBe(
      true,
    );
    run(e, 5);
    svc.pump();
    await flush();
    expect(calls).toBe(2);
    expect(() => parseSave(e.state)).not.toThrow();
    svc.dispose();
  });
  it('a cancelled hung provider releases its request and a retry can answer the same message', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(battle),
      content: '情况如何？',
      mentions: [],
    });
    const msg = [...e.state.chatMessages].reverse().find((m) => m.sender === e.state.commander.id)!;
    const svc = service(e, new ChatCompletionsClient(async () => new Promise(() => {})));
    svc.pump();
    await flush();
    expect(msg.responses?.[battle]).toBe('pending');
    e.dispatchCommand({ type: 'cancelAgentReply', agentId: battle, messageId: msg.id });
    svc.pump();
    await flush();
    expect({
      responses: msg.responses,
      decision: e.state.agents.find((a) => a.id === battle)!.decision,
    }).toMatchObject({ responses: { [battle]: 'cancelled' } });
    expect(
      e.state.chatMessages.some((m) => m.replyTo === msg.id && m.content.includes('取消')),
    ).toBe(true);
    svc.dispose();
    e.dispatchCommand({ type: 'retryAgent', agentId: battle, messageId: msg.id });
    const next = service(
      e,
      new ChatCompletionsClient(async () =>
        response({ goal: '等待', rationale: '已恢复通讯', action: null }),
      ),
    );
    next.pump();
    await flush();
    expect(msg.responses?.[battle]).toBe('replied');
    next.dispose();
  });
  it('cancelling a pending reply aborts its authority and late results cannot act', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === freight)!.enabled = false;
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(battle),
      content: '巡逻基地 30 分钟',
      mentions: [],
    });
    const msg = [...e.state.chatMessages].reverse().find((m) => m.sender === e.state.commander.id)!;
    let release: () => void = () => {};
    const svc = service(
      e,
      new ChatCompletionsClient(async () => {
        await new Promise<void>((done) => {
          release = done;
        });
        return response({ accept: true, reason: 'preference', rationale: '可以巡逻' });
      }),
    );
    svc.pump();
    await flush();
    expect(
      e.dispatchCommand({ type: 'cancelAgentReply', agentId: battle, messageId: msg.id }).ok,
    ).toBe(true);
    svc.pump();
    release();
    await flush();
    expect(msg.responses?.[battle]).toBe('cancelled');
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current).toBeNull();
    svc.dispose();
  });
  it('migrates every v14 daily/head/backup without modifying old bytes or replaying history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-v15-migration-'));
    dirs.push(dir);
    const w = quietEngine().state;
    const old = { ...w, version: 14, agents: w.agents.map(({ stateDynamics: _, ...a }) => a) };
    const bytes = JSON.stringify(old),
      root = join(dir, 'frontiers-v14', 'frontier-000001');
    mkdirSync(root, { recursive: true });
    for (const name of ['head.json', 'head.json.bak', 'day-1.json'])
      writeFileSync(join(root, name), bytes);
    writeFileSync(
      join(dir, 'timeline-v14.json'),
      JSON.stringify({
        version: 14,
        activeId: 'frontier-000001',
        branches: [{ id: 'frontier-000001', name: '旧世界', parent: null }],
      }),
    );
    const store = new SaveStore(dir);
    expect(store.read().world?.version).toBe(15);
    expect(store.read().world?.history).toEqual(w.history);
    for (const name of ['head.json', 'head.json.bak', 'day-1.json']) {
      expect(readFileSync(join(root, name), 'utf8')).toBe(bytes);
      expect(
        JSON.parse(readFileSync(join(store.root, 'frontier-000001', name), 'utf8')).version,
      ).toBe(15);
    }
  });
  it('a migration with a corrupt day publishes nothing and can be retried after repairing the old file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-v15-migration-error-'));
    dirs.push(dir);
    const w = quietEngine().state,
      old = { ...w, version: 14, agents: w.agents.map(({ stateDynamics: _, ...a }) => a) },
      bytes = JSON.stringify(old),
      root = join(dir, 'frontiers-v14', 'frontier-000001');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'head.json'), bytes);
    writeFileSync(join(root, 'day-1.json'), '{broken');
    writeFileSync(
      join(dir, 'timeline-v14.json'),
      JSON.stringify({
        version: 14,
        activeId: 'frontier-000001',
        branches: [{ id: 'frontier-000001', parent: null }],
      }),
    );
    expect(new SaveStore(dir).read().blocked).toBe(true);
    expect(existsSync(join(dir, 'timeline-v15.json'))).toBe(false);
    expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(bytes);
    writeFileSync(join(root, 'day-1.json'), bytes);
    const recovered = new SaveStore(dir);
    expect(recovered.read().world?.version).toBe(15);
    const index = readFileSync(join(dir, 'timeline-v15.json'), 'utf8');
    writeFileSync(join(recovered.root, '.migration-v15.json'), index);
    rmSync(join(dir, 'timeline-v15.json'));
    expect(new SaveStore(dir).read().world?.version).toBe(15);
    expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(bytes);
  });
});
