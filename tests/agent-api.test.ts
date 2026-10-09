import {askIntent,conversation} from './provider-harness';
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
  reasoningEffort: 'provider-default',
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
  it('per-Agent model/thinking/effort are independent; unsupported explicit reasoning never silently changes',async()=>{
    const bodies:Record<string,unknown>[]=[];const client=new ChatCompletionsClient(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return response(JSON.stringify(conversation()));});
    const e=quietEngine(),known={...config,baseUrl:'https://api.openai.com/v1',defaultModel:'gpt-5.1'};
    e.dispatchCommand({type:'configureAgent',agentId:'ops-meridian',enabled:true,modelConfig:{model:'gpt-5.1',reasoningEffort:'provider-default',thinking:'off'}});
    e.dispatchCommand({type:'configureAgent',agentId:'ops-horizon',enabled:true,modelConfig:{model:'gpt-5.2',reasoningEffort:'high',thinking:'on'}});
    await askIntent(client,known,e.getObservation('ops-meridian')!);await askIntent(client,known,e.getObservation('ops-horizon')!);
    expect(bodies[0]).toMatchObject({model:'gpt-5.1',reasoning_effort:'none'});expect(bodies[1]).toMatchObject({model:'gpt-5.2',reasoning_effort:'high'});
    let requests=0;const rejected=new ChatCompletionsClient(async()=>{requests++;return new Response('unsupported reasoning_effort',{status:400});});
    await expect(askIntent(rejected,known,e.getObservation('ops-horizon')!)).rejects.toThrow('未改动');expect(requests).toBe(1);
    await expect(askIntent(rejected,config,e.getObservation('ops-horizon')!)).rejects.toThrow(/未确认|未知|不支持/);expect(requests).toBe(1);
    expect(JSON.stringify(bodies)).not.toContain(config.apiKey);expect(JSON.stringify(bodies)).not.toContain('initialSeed');
  });
  it('connectivity only negotiates output format and protects credentials', async () => {
    let count = 0;
    const client = new ChatCompletionsClient(async () => {
      count++;
      if(count===1)return new Response('response_format unsupported',{status:400});
      return response('{"ok":true}');
    });
    const result = await client.test(config);
    expect(result.ok).toBe(true);
    expect(count).toBe(2);
    expect(result.reason).toContain('Thinking/Effort 沿用配置');
    const failing = new ChatCompletionsClient(
      async () => new Response('Provider echoed ' + config.apiKey, { status: 401 }),
    );
    await expect(failing.test(config)).rejects.toThrow('认证失败');
    const echoed = new ChatCompletionsClient(async () =>
      response(jsonDecision(null, config.apiKey)),
    );
    await expect(
      askIntent(echoed, config, quietEngine().getObservation('ops-meridian')!),
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
      askIntent(escapedEcho, config, quietEngine().getObservation('ops-meridian')!),
    ).rejects.toThrow('凭据');
  });
  it('rejects illegal JSON/schema/oversized responses and permits explicit cancellation of a hung provider', async () => {
    const obs = quietEngine().getObservation('ops-meridian')!;
    for (const output of [
      'not-json',
      '{"goal":"x","rationale":"y","action":{"type":"CHEAT"}}',
      '{"goal":"x","rationale":"y","action":null,"seed":4}',
    ]) {
      await expect(
        askIntent(new ChatCompletionsClient(async () => response(output)), config, obs),
      ).rejects.toThrow(/JSON|格式/);
    }
    await expect(
      askIntent(new ChatCompletionsClient(async () => response('x'.repeat(130000))), config, obs),
    ).rejects.toThrow('过大');
    const hung: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      });
    const controller = new AbortController();
    const pending = askIntent(new ChatCompletionsClient(hung), config, obs, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('取消');
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
  it('player conversation stays one flight while simulation advances and creates no unrequested physical task', async () => {
    const e = quietEngine();
    e.state.agents.find((a) => a.id === 'ops-horizon')!.enabled = false;
    let calls = 0,
      release: (() => void) | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const observation=JSON.parse(body.messages[1].content);expect(observation.input).toContain('休息');
      await new Promise<void>(r=>release=r);return response(JSON.stringify(conversation('我会结合舰况考虑休息安排。')));
    };
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        cognitionPort: (id) => e.cognitionPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      new ChatCompletionsClient(fetcher),
    );
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel('ops-meridian'),
      content: '聊聊休息安排。',
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
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current).toBeNull();
    expect(e.state.objectives).toHaveLength(0);
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
        cognitionPort: (id) => e.cognitionPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      client,
    );
    e.dispatchCommand({type:'sendChat',channelId:privateChannel('ops-meridian'),content:'计划从矿场运输到基地，请完整评估。',mentions:[]});
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
  it('errors update waiting state without duplicate chat and explicit retry has no tick storm', async () => {
    const e = quietEngine();
    e.state.agents[0].enabled = false;
    e.state.paused = false;
    let calls = 0;
    const client = new ChatCompletionsClient(async () => {
      calls++;
      return response(
        calls <= 3
          ? 'broken JSON'
          : JSON.stringify({opportunityId:null,riskPreference:'cautious',reason:'没有新目标，等待。'}),
      );
    });
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        cognitionPort: (id) => e.cognitionPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
      },
      () => config,
      client,
    );
    e.dispatchCommand({type:'retryAgent',agentId:'ops-meridian'});
    service.pump();
    await flush();
    expect(e.state.agents[1].status).toBe('error');
    expect(e.state.chatMessages.filter(m=>m.kind==='error')).toHaveLength(0);
    expect(e.state.agents[1].decision.lastError).toBeTruthy();
    run(e, 1);
    for (let i = 0; i < 30; i++) service.pump();
    expect(calls).toBe(2);
    expect(JSON.stringify(e.snapshot())).not.toContain(config.apiKey);
    e.dispatchCommand({ type: 'retryAgent', agentId: 'ops-meridian' });
    service.pump();
    await flush();
    expect(calls).toBe(4);
    expect(e.state.agents[1].status).toBe('online');
    service.dispose();
  });
});
