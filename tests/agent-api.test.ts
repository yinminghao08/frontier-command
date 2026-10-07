import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentConfigStore,
  type ConnectionConfig,
  type SecretVault,
} from '../electron/agents/config';
import { ChatCompletionsClient } from '../electron/agents/client';
import { AgentDecisionService } from '../electron/agents/service';
import { quietEngine, issue, run } from './helpers';
import { privateChannel } from '../src/engine/chat';
const config: ConnectionConfig = {
  baseUrl: 'https://compatible.invalid/v1',
  defaultModel: 'default-model',
  reasoningEffort: 'medium',
  apiKey: 'test-only-secret-never-record',
};
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
});
function response(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}
const jsonDecision = (action: unknown = null, goal = '根据聊天重新考虑目标') =>
  JSON.stringify({ goal, rationale: '结合近期聊天、性格和公开状态', action });
async function flush() {
  for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
describe('Chat Completions compatible transport and protected credentials', () => {
  it('NONE omits reasoning, per-Agent overrides are independent, unsupported reasoning safely retries once', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if ('reasoning_effort' in body)
        return new Response(
          JSON.stringify({
            error: {
              message: 'Unsupported parameter: reasoning_effort',
              param: 'reasoning_effort',
            },
          }),
          { status: 400 },
        );
      return response(jsonDecision());
    };
    const client = new ChatCompletionsClient(fetcher),
      e = quietEngine();
    e.dispatchCommand({
      type: 'configureAgent',
      agentId: 'ops-meridian',
      enabled: true,
      modelConfig: { model: 'freight-model', reasoningEffort: 'none' },
    });
    e.dispatchCommand({
      type: 'configureAgent',
      agentId: 'ops-horizon',
      enabled: true,
      modelConfig: { model: 'tactical-model', reasoningEffort: 'high' },
    });
    await client.decide(config, e.getObservation('ops-meridian')!);
    await client.decide(config, e.getObservation('ops-horizon')!);
    expect(bodies[0].model).toBe('freight-model');
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1].model).toBe('tactical-model');
    expect(bodies[1].reasoning_effort).toBe('high');
    expect(bodies[2]).not.toHaveProperty('reasoning_effort');
    expect(JSON.stringify(bodies)).not.toContain(config.apiKey);
    expect(JSON.stringify(bodies)).not.toContain('initialSeed');
  });
  it('connectivity test supports response_format and reasoning fallback without exposing provider errors', async () => {
    let count = 0;
    const client = new ChatCompletionsClient(async () => {
      count++;
      if (count === 1) return new Response('reasoning_effort unsupported', { status: 422 });
      if (count === 2) return new Response('response_format unsupported', { status: 400 });
      return response('{"ok":true}');
    });
    const result = await client.test(config);
    expect(result.ok).toBe(true);
    expect(count).toBe(3);
    expect(result.reason).toContain('兼容省略');
    const failing = new ChatCompletionsClient(
      async () => new Response('Provider echoed ' + config.apiKey, { status: 401 }),
    );
    await expect(failing.test(config)).rejects.toThrow('认证失败');
    const echoed = new ChatCompletionsClient(async () =>
      response(jsonDecision(null, config.apiKey)),
    );
    await expect(
      echoed.decide(config, quietEngine().getObservation('ops-meridian')!),
    ).rejects.toThrow('凭据');
    const escapedEcho = new ChatCompletionsClient(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: jsonDecision(null, config.apiKey) } }],
          }).replaceAll(
            config.apiKey,
            Array.from(
              config.apiKey,
              (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
            ).join(''),
          ),
          { status: 200 },
        ),
    );
    await expect(
      escapedEcho.decide(config, quietEngine().getObservation('ops-meridian')!),
    ).rejects.toThrow('凭据');
  });
  it('rejects illegal JSON/schema/oversized responses and bounds a hung provider by timeout', async () => {
    const obs = quietEngine().getObservation('ops-meridian')!;
    for (const output of [
      'not-json',
      '{"goal":"x","rationale":"y","action":{"type":"CHEAT"}}',
      '{"goal":"x","rationale":"y","action":null,"seed":4}',
    ]) {
      await expect(
        new ChatCompletionsClient(async () => response(output)).decide(config, obs),
      ).rejects.toThrow(/JSON|schema/);
    }
    await expect(
      new ChatCompletionsClient(async () => response('x'.repeat(130000))).decide(config, obs),
    ).rejects.toThrow('过大');
    const hung: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      });
    await expect(new ChatCompletionsClient(hung, 25).decide(config, obs)).rejects.toThrow('超时');
  });
  it('persists only encrypted Key outside saves and returns only public API metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-agent-config-'));
    dirs.push(dir);
    const vault: SecretVault = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(Buffer.from(value).map((x) => x ^ 0x70)),
      decryptString: (value) => Buffer.from(value.map((x) => x ^ 0x70)).toString('utf8'),
    };
    const store = new AgentConfigStore(dir, vault);
    store.update({
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      reasoningEffort: 'none',
      apiKey: config.apiKey,
    });
    expect(readFileSync(join(dir, 'agent-api.v1.json'), 'utf8')).not.toContain(config.apiKey);
    expect(store.publicSettings().hasKey).toBe(true);
    expect(store.publicSettings()).not.toHaveProperty('apiKey');
    expect(store.publicSettings()).not.toHaveProperty('encryptedKey');
    expect(new AgentConfigStore(dir, vault).connection().apiKey).toBe(config.apiKey);
    store.update({ baseUrl: config.baseUrl, defaultModel: 'new-model', reasoningEffort: 'high' });
    expect(store.connection().apiKey).toBe(config.apiKey);
    store.update({
      baseUrl: config.baseUrl,
      defaultModel: 'new-model',
      reasoningEffort: 'none',
      clearKey: true,
    });
    expect(store.publicSettings().hasKey).toBe(false);
    const unavailable = new AgentConfigStore(dir, { ...vault, isEncryptionAvailable: () => false });
    expect(() =>
      unavailable.update({
        baseUrl: config.baseUrl,
        defaultModel: 'x',
        reasoningEffort: 'none',
        apiKey: config.apiKey,
      }),
    ).toThrow('加密不可用');
    expect(() =>
      store.update({
        baseUrl: 'https://secret:password@example.com/v1',
        defaultModel: 'x',
        reasoningEffort: 'none',
      }),
    ).toThrow();
  });
});
describe('asynchronous decision nodes, real chat influence and late-result authority', () => {
  it('calls only at decision nodes, keeps simulation moving while pending, and applies model-selected actions from private chat', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === 'ops-horizon')!.enabled = false;
    let calls = 0,
      release: (() => void) | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const observation = JSON.parse(body.messages[1].content);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return response(
        jsonDecision(
          observation.recentChat.some((m: { content: string }) => m.content.includes('休息'))
            ? { type: 'DOCK', targetId: 'base' }
            : { type: 'PATROL', targetId: 'mine', duration: 30 },
          '根据 Admiral 私聊选择休息',
        ),
      );
    };
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (id) => e.controllerPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      new ChatCompletionsClient(fetcher),
    );
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel('ops-meridian'),
      content: '请先回基地休息。',
      mentions: [],
    });
    service.pump();
    expect(calls).toBe(1);
    expect(e.state.agents[1].status).toBe('waiting');
    run(e, 10);
    for (let i = 0; i < 100; i++) service.pump();
    expect(e.state.time).toBe(10);
    expect(calls).toBe(1);
    release!();
    await flush();
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('DOCK');
    expect(e.state.agents[1].currentGoal).toContain('私聊');
    expect(e.state.agents[1].memory.some((m) => m.summary.includes('休息'))).toBe(true);
    service.dispose();
  });
  it('drops stale model responses after Admiral takes over, and aborts requests when a world is replaced', async () => {
    const e = quietEngine();
    e.state.agents[0].enabled = false;
    e.state.paused = false;
    let release: (() => void) | undefined;
    const client = new ChatCompletionsClient(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return response(
        jsonDecision({
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 30,
          route: 'safe',
          repeat: false,
        }),
      );
    });
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
    expect(e.state.agents[1].status).toBe('waiting');
    issue(e, { type: 'MOVE', point: { x: 0, y: 0 } }, 'meridian');
    release!();
    await flush();
    expect(e.state.ships[0].current?.source).toBe('admiral');
    expect(e.state.ships[0].current?.action.type).toBe('MOVE');
    service.dispose();
    expect(e.state.chatMessages.some((m) => m.content.includes('执行 HAUL'))).toBe(false);
  });
  it('errors become private communications, keep valid saves, and can be retried without a tick storm', async () => {
    const e = quietEngine();
    e.state.agents[0].enabled = false;
    e.state.paused = false;
    let calls = 0;
    const client = new ChatCompletionsClient(async () => {
      calls++;
      return response(
        calls === 1
          ? 'broken JSON'
          : jsonDecision({ type: 'PATROL', targetId: 'mine', duration: 10 }),
      );
    });
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
    expect(e.state.agents[1].status).toBe('error');
    expect(e.state.chatMessages.at(-1)?.kind).toBe('error');
    run(e, 1);
    for (let i = 0; i < 30; i++) service.pump();
    expect(calls).toBe(1);
    expect(JSON.stringify(e.snapshot())).not.toContain(config.apiKey);
    e.dispatchCommand({ type: 'retryAgent', agentId: 'ops-meridian' });
    service.pump();
    await flush();
    expect(calls).toBe(2);
    expect(e.state.agents[1].status).toBe('executing');
    service.dispose();
  });
});
