import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestTracker } from '../electron/agents/runtime';
import { ChatCompletionsClient } from '../electron/agents/client';
import { AgentDecisionService } from '../electron/agents/service';
import { quietEngine, issue, run } from './helpers';
import { appendChat, COMMAND_CHANNEL, privateChannel } from '../src/engine/chat';
import type { ConnectionConfig } from '../electron/agents/config';
import { decisionJsonSchema } from '../src/engine/decision-protocol';
const config: ConnectionConfig = {
  baseUrl: 'http://127.0.0.1/v1',
  defaultModel: 'isolated-test',
  reasoningEffort: 'none',
  apiKey: 'test-budget-key',
};
const budgets: RequestTracker[] = [],
  dirs: string[] = [];
function budget(directory?: string) {
  const b = new RequestTracker();
  budgets.push(b);
  return b;
}
const reply = (
  content = '{"goal":"等待实质变化","rationale":"当前无新的选择","action":null}',
  usage?: number,
) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage === undefined ? {} : { usage: { total_tokens: usage } }),
    }),
  );
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
}
const fakeClock = () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
};
afterEach(() => {
  for (const b of budgets.splice(0)) b.dispose();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('unlimited HTTP telemetry', () => {
  it('starts more than two concurrent requests and over twelve attempts without waiting', async () => {
    fakeClock();
    const b = budget();
    const releases = await Promise.all(Array.from({ length: 20 }, () => b.acquire('a', 'initial')));
    expect(b.stats()).toMatchObject({
      requests: 20,
      concurrency: 20,
      windowRequests: 20,
      byAgent: { a: 20 },
    });
    releases.forEach((release) => {
      release();
      release();
    });
    expect(b.stats().concurrency).toBe(0);
    const abort = new AbortController();
    abort.abort();
    await expect(b.acquire('a', 'repair', abort.signal)).rejects.toThrow('cancelled');
    expect(b.stats().requests).toBe(20);
    await vi.advanceTimersByTimeAsync(60000);
    expect(b.stats().windowRequests).toBe(0);
  });
  it('obsolete runtime settings cannot throttle a restarted tracker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-old-quota-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'agent-runtime.v1.json'),
      JSON.stringify({
        version: 1,
        settings: { globalPerMinute: 1, agentPerMinute: 1 },
        recent: [{ at: Date.now(), agentId: 'a' }],
      }),
    );
    const tracker = budget(dir);
    const releases = await Promise.all(
      Array.from({ length: 4 }, () => tracker.acquire('a', 'initial')),
    );
    expect(tracker.stats().requests).toBe(4);
    releases.forEach((release) => release());
    expect(tracker.stats()).not.toHaveProperty('settings');
    expect(tracker.stats()).not.toHaveProperty('queued');
  });
  it('provider token usage is exact and a missing usage changes display to unknown', () => {
    const b = budget();
    b.usage({ total_tokens: 42 });
    expect(b.stats().tokens).toBe(42);
    b.usage(undefined);
    expect(b.stats().tokens).toBeNull();
  });
  it('compatibility, correction and connection tests acquire separate counted HTTP requests', async () => {
    fakeClock();
    const b = budget();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      if (calls === 1) return new Response('reasoning_effort unsupported', { status: 400 });
      if (calls === 2) return new Response('response_format unsupported', { status: 400 });
      if (calls === 3) return reply('not-json');
      return reply(undefined, 7);
    };
    const client = new ChatCompletionsClient(fetcher, 45000, b);
    await client.decide(
      { ...config, reasoningEffort: 'high' },
      quietEngine().getObservation('ops-meridian')!,
    );
    expect(b.stats()).toMatchObject({ requests: 4, repairs: 1, tokens: null });
    const testing = new ChatCompletionsClient(async () => reply('{"ok":true}', 3), 45000, b);
    await testing.test(config);
    expect(b.stats().requests).toBe(5);
    expect(b.stats().byAgent['admiral:test']).toBe(1);
  });
  it('third HTTP request starts while two earlier requests are in flight', async () => {
    const b = budget();
    let calls = 0;
    const resolve: (() => void)[] = [];
    const client = new ChatCompletionsClient(
      async () => {
        calls++;
        await new Promise<void>((done) => resolve.push(done));
        return reply();
      },
      45000,
      b,
    );
    const requests = Array.from({ length: 3 }, () =>
      client.decide(config, quietEngine().getObservation('ops-meridian')!),
    );
    await flush();
    expect(calls).toBe(3);
    expect(b.stats().concurrency).toBe(3);
    resolve.forEach((done) => done());
    await Promise.all(requests);
    expect(b.stats().concurrency).toBe(0);
  });
  it('one repair shares the same 20 second network deadline and releases its slot', async () => {
    fakeClock();
    const b = budget();
    let calls = 0;
    const fetcher: typeof fetch = (_url, init) =>
      new Promise((resolve, reject) => {
        calls++;
        const timer = setTimeout(() => resolve(reply('bad-json')), calls === 1 ? 12000 : 20000);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(Error('aborted'));
          },
          { once: true },
        );
      });
    const result = new ChatCompletionsClient(fetcher, 20000, b)
      .decide(config, quietEngine().getObservation('ops-meridian')!)
      .catch((error) => error as Error);
    await flush();
    await vi.advanceTimersByTimeAsync(20000);
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('超时');
    expect(calls).toBe(2);
    expect(b.stats().concurrency).toBe(0);
  });
  it.each([1, 4, 16] as const)(
    '%sx preserves idle zero calls and permits every explicit retry without quotas',
    async (speed) => {
      fakeClock();
      const b = budget(),
        e = quietEngine();
      e.state.speed = speed;
      e.state.paused = false;
      let calls = 0;
      const client = new ChatCompletionsClient(
        async () => {
          calls++;
          return reply();
        },
        45000,
        b,
      );
      const service = new AgentDecisionService(
        {
          snapshot: () => e.snapshot(),
          controllerPort: (id) => e.controllerPort(id),
          command: (c, id) => e.dispatchCommand(c, id),
          validate: (c, id) => e.validate(c, id),
        },
        () => config,
        client,
      );
      service.pump();
      await flush();
      for (let i = 0; i < 300; i++) {
        e.advanceFrame();
        service.pump();
      }
      await flush();
      expect(calls).toBe(2);
      for (let i = 0; i < 8; i++) {
        e.dispatchCommand({ type: 'retryAgent', agentId: 'ops-meridian' });
        service.pump();
        await flush();
      }
      expect(calls).toBe(10);
      expect(b.stats().concurrency).toBe(0);
      service.dispose();
      await flush();
      expect(b.stats().concurrency).toBe(0);
    },
  );
});

describe('v13 meaningful event dispatch and bounded error recovery', () => {
  it('a paused task replaces an old flight and asks for voluntary consent in the same pump', async () => {
    const e = quietEngine();
    e.state.agents[0].enabled = false;
    const target = 'ops-meridian';
    const resolves: (() => void)[] = [];
    let calls = 0;
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (id) => e.controllerPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
        validate: (c, id) => e.validate(c, id),
      },
      () => config,
      new ChatCompletionsClient(async (_url, init) => {
        calls++;
        const obs = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
        if (calls === 1) {
          await new Promise<void>((done) => resolves.push(done));
          return reply('{"goal":"stale","rationale":"old","action":null}');
        }
        const task = obs.task;
        expect(task.consent).toBe('proposed');
        expect(JSON.parse(String(init?.body)).messages[0].content).toMatch(/^TASK_JUDGMENT:/);
        return reply(
          JSON.stringify({ accept: true, rationale: '风险可接受', reason: 'preference' }),
        );
      }),
    );
    e.dispatchCommand({ type: 'retryAgent', agentId: target });
    service.pump();
    await flush();
    expect(calls).toBe(1);
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(target),
      content: '巡逻基地 5 分钟',
      mentions: [],
    });
    service.pump();
    await flush();
    expect(calls).toBe(2);
    expect(e.state.admiralTasks[0].consent).toBe('accepted');
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('PATROL');
    resolves[0]();
    await flush();
    expect(e.state.agents.find((a) => a.id === target)!.currentGoal).not.toBe('stale');
    expect(e.state.paused).toBe(true);
    run(e, 1);
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('PATROL');
    service.dispose();
  });
  it('fresh private and directed group input interrupts transient backoff and exhausted failures', async () => {
    fakeClock();
    const e = quietEngine();
    e.state.agents[0].enabled = false;
    let calls = 0;
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (id) => e.controllerPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      new ChatCompletionsClient(async () => {
        calls++;
        throw Error('network test');
      }),
    );
    e.dispatchCommand({ type: 'retryAgent', agentId: 'ops-meridian' });
    service.pump();
    await flush();
    expect(calls).toBe(1);
    for (let i = 0; i < 4; i++) {
      e.dispatchCommand({
        type: 'sendChat',
        channelId: i % 2 ? COMMAND_CHANNEL : privateChannel('ops-meridian'),
        content: '请评估风险 ' + i,
        mentions: i % 2 ? ['ops-meridian'] : [],
      });
      service.pump();
      await flush();
      expect(calls).toBe(i + 2);
    }
    service.pump();
    await flush();
    expect(calls).toBe(5);
    service.dispose();
  });
  it('more than three decision messages pass provider schema and commit to the engine', async () => {
    const e = quietEngine();
    const target = 'ops-meridian';
    const messages = Array.from({ length: 6 }, (_, i) => ({
      channelId: privateChannel(target),
      content: '独立信息 ' + i,
      mentions: [],
    }));
    const client = new ChatCompletionsClient(async () =>
      reply(JSON.stringify({ goal: '交流', rationale: '六条独立信息', action: null, messages })),
    );
    const decision = await client.decide(config, e.getObservation(target)!);
    const schema = decisionJsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(schema.messages).not.toHaveProperty('maxItems');
    const revision = e.state.agents.find((a) => a.id === target)!.decision.revision;
    expect(
      e.dispatchCommand({ type: 'agentDecision', agentId: target, revision, decision }, target).ok,
    ).toBe(true);
    expect(
      e.state.chatMessages.filter((m) => m.sender === target && m.origin === 'agent'),
    ).toHaveLength(6);
  });
  it('engine completion and @ reports cost zero calls; stale HTTP results cannot overwrite a takeover', async () => {
    const b = budget(),
      e = quietEngine();
    e.state.agents[0].enabled = false;
    e.state.paused = false;
    let calls = 0,
      release: (() => void) | undefined;
    const client = new ChatCompletionsClient(
      async () => {
        calls++;
        await new Promise<void>((r) => {
          release = r;
        });
        return reply(
          '{"goal":"过期动作","rationale":"旧观察","action":{"type":"MOVE","point":{"x":0,"y":0}}}',
        );
      },
      45000,
      b,
    );
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (id) => e.controllerPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      client,
    );
    service.pump();
    await flush();
    expect(calls).toBe(1);
    issue(e, { type: 'REST', targetId: 'base', duration: 1 }, 'meridian');
    service.pump();
    release!();
    await flush();
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('REST');
    run(e, 80);
    service.pump();
    await flush();
    expect(calls).toBe(1);
    appendChat(e, 'ops-meridian', COMMAND_CHANNEL, '@Talia 本轮已完成', [], 'report', {
      eventId: 'zero-call-report',
    });
    service.pump();
    await flush();
    expect(calls).toBe(1);
    service.dispose();
    expect(b.stats().cancellations).toBe(1);
  });
  it('transient failures retry in real time with bounded exponential backoff, never on sim acceleration', async () => {
    fakeClock();
    const b = budget(),
      e = quietEngine();
    e.state.agents[0].enabled = false;
    e.state.paused = false;
    let calls = 0;
    const client = new ChatCompletionsClient(
      async () => {
        calls++;
        throw Error('network test');
      },
      45000,
      b,
    );
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (id) => e.controllerPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      client,
    );
    service.pump();
    await flush();
    expect(calls).toBe(1);
    run(e, 500);
    service.pump();
    await flush();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    service.pump();
    await flush();
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(120000);
    service.pump();
    await flush();
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(600000);
    service.pump();
    await flush();
    expect(calls).toBe(3);
    service.dispose();
  });
  it('authentication failure waits for configuration/manual retry, with no automatic repeated errors', async () => {
    fakeClock();
    const b = budget(),
      e = quietEngine();
    e.state.agents[0].enabled = false;
    e.state.paused = false;
    let calls = 0;
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (id) => e.controllerPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      new ChatCompletionsClient(
        async () => {
          calls++;
          return new Response('unauthorized', { status: 401 });
        },
        45000,
        b,
      ),
    );
    service.pump();
    await flush();
    const messages = e.state.chatMessages.filter((m) => m.kind === 'error').length;
    await vi.advanceTimersByTimeAsync(600000);
    run(e, 500);
    service.pump();
    await flush();
    expect(calls).toBe(1);
    expect(e.state.chatMessages.filter((m) => m.kind === 'error')).toHaveLength(messages);
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel('ops-meridian'),
      content: '请重新考虑风险。',
      mentions: [],
    });
    service.pump();
    await flush();
    expect(calls).toBe(1);
    e.dispatchCommand({ type: 'retryAgent', agentId: 'ops-meridian' });
    service.pump();
    await flush();
    expect(calls).toBe(2);
    service.dispose();
  });
});
