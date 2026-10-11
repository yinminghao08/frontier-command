import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatCompletionsClient } from '../electron/agents/client';
import { ModelRegistry } from '../electron/agents/model-registry';
import { RequestTracker } from '../electron/agents/runtime';
import {
  AgentConfigStore,
  type ConnectionConfig,
  type SecretVault,
} from '../electron/agents/config';
import type { ReasoningEffort, ThinkingMode } from '../src/engine/types';
import { parseSave } from '../src/engine/saves';
import { SimulationEngine } from '../src/engine/engine';
import { deepSeekEffort, effortLabel } from '../src/engine/deepseek';
import { ReasoningNotice } from '../src/ui/ReasoningNotice';
import { LcarsProvider } from '../src/ui/lcars/LcarsProvider';
import { quietEngine } from './helpers';
import { askIntent, conversation } from './provider-harness';

const config: ConnectionConfig = {
  baseUrl: 'https://api.deepseek.com',
  defaultModel: 'deepseek-flash',
  apiKey: 'mock-key-do-not-log',
  thinking: 'provider-default',
  reasoningEffort: 'provider-default',
  modelPricesCny: { 'deepseek-flash': { input: 2, cacheHit: 0.2, output: 8 } },
};
const usage = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  total_tokens: 1200,
  completion_tokens_details: { reasoning_tokens: 150 },
  prompt_cache_hit_tokens: 600,
  prompt_cache_miss_tokens: 400,
};
const expectedCost = 0.00252;
const reply = (content = JSON.stringify(conversation()), extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage, ...extra }),
  );
function fixture(respond: () => Response = () => reply()) {
  const bodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return respond();
  });
  const tracker = new RequestTracker();
  return { bodies, fetcher, tracker, client: new ChatCompletionsClient(fetcher, tracker) };
}
const complete = (
  f: ReturnType<typeof fixture>,
  thinking: ThinkingMode,
  effort: ReasoningEffort,
  override: Partial<ConnectionConfig> = {},
) =>
  f.client.complete({ ...config, ...override, thinking }, config.defaultModel, effort, [
    { role: 'user', content: 'Return JSON.' },
  ]);

describe('DeepSeek official thinking controls and bounded request policy (Mock only)', () => {
  it.each([
    ['off', 'provider-default', { thinking: { type: 'disabled' } }, 900, 'off'],
    ['on', 'provider-default', { thinking: { type: 'enabled' } }, 4096, 'on'],
    ['on', 'low', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }, 4096, 'on'],
    ['on', 'high', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, 4096, 'on'],
    ['on', 'max', { thinking: { type: 'enabled' }, reasoning_effort: 'max' }, 4096, 'on'],
    ['provider-default', 'provider-default', {}, 4096, 'on'],
    ['provider-default', 'low', { reasoning_effort: 'low' }, 4096, 'on'],
    ['on', 'minimal', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }, 4096, 'on'],
    ['on', 'medium', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, 4096, 'on'],
    ['on', 'xhigh', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }, 4096, 'on'],
  ] as const)(
    '%s / %s sends exact controls',
    async (thinking, effort, fields, maxTokens, actual) => {
      const f = fixture();
      await complete(f, thinking, effort);
      expect(f.bodies).toHaveLength(1);
      const body = f.bodies[0];
      expect(body).toMatchObject({
        model: 'deepseek-flash',
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        stream: true,
        stream_options: { include_usage: true },
        ...fields,
      });
      for (const field of ['thinking', 'reasoning_effort'])
        if (!(field in fields)) expect(body).not.toHaveProperty(field);
      expect(body).not.toHaveProperty('enable_thinking');
      expect(body).not.toHaveProperty('max_completion_tokens');
      expect(f.tracker.stats().recentRequests[0].effective).toMatchObject({
        provider: 'api.deepseek.com',
        model: 'deepseek-flash',
        thinking: actual,
        thinkingSource: thinking,
        maxTokens,
      });
      expect(f.tracker.stats().costCny).toBeCloseTo(expectedCost);
    },
  );

  it.each(['low', 'high', 'max', 'minimal', 'medium', 'xhigh'] as const)(
    'OFF + %s rejects before any paid request',
    async (effort) => {
      const f = fixture();
      await expect(complete(f, 'off', effort)).rejects.toMatchObject({ kind: 'validation' });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['intent', 4096, 1800],
    ['communication', 2048, 900],
    ['judgment', 3072, 900],
    ['collaboration', 3072, 900],
    ['strategy', 4096, 900],
  ])('bounds %s by actual thinking and purpose', async (purpose, thinkingTokens, outputTokens) => {
    const f = fixture();
    for (const thinking of ['on', 'off'] as const) {
      await f.client.complete(
        { ...config, thinking },
        config.defaultModel,
        'provider-default',
        [],
        undefined,
        undefined,
        { agentId: 'a', kind: 'initial', startedAt: Date.now(), purpose: String(purpose) },
        { outputBudget: 100000 },
      );
      expect(f.bodies.at(-1)?.max_tokens).toBe(thinking === 'on' ? thinkingTokens : outputTokens);
    }
    await complete(f, 'on', 'max', { thinkingBudget: 2048 });
    expect(f.bodies.at(-1)?.max_tokens).toBe(2048);
    await complete(f, 'on', 'max', { thinkingBudget: 999999 });
    expect(f.bodies.at(-1)?.max_tokens).toBe(32768);
  });

  it('supported thinking capability alone does not activate a reasoning budget', async () => {
    const f = fixture();
    await f.client.complete(
      { ...config, baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.1' },
      'gpt-5.1',
      'provider-default',
      [],
    );
    expect(f.bodies[0]).toMatchObject({ max_completion_tokens: 900 });
    await f.client.complete(
      { ...config, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', thinking: 'off' },
      'qwen3-32b',
      'provider-default',
      [],
    );
    expect(f.bodies[1]).toMatchObject({ enable_thinking: false, max_tokens: 900 });
  });

  it('connection test overrides thinking at 64 tokens; configuration test retains real settings', async () => {
    const f = fixture(() => reply('{"ok":true}'));
    const settings = {
      ...config,
      thinking: 'on' as const,
      reasoningEffort: 'max' as const,
      thinkingBudget: 6000,
    };
    expect((await f.client.test(settings)).reason).toContain('未验证真实');
    expect(f.bodies[0]).toMatchObject({
      thinking: { type: 'disabled' },
      max_tokens: 64,
      stream: false,
    });
    expect(f.bodies[0]).not.toHaveProperty('reasoning_effort');
    expect((await f.client.test(settings, undefined, 'configuration')).reason).toContain(
      '真实配置验证',
    );
    expect(f.bodies[1]).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
      max_tokens: 6000,
      stream: true,
    });
  });
});

describe('DeepSeek directory metadata, independent overrides and persistence', () => {
  it('uses official effort.supported_levels across directory refreshes and client calls', async () => {
    let levels = ['high', 'max'];
    const fetcher: typeof fetch = vi.fn(async (url) =>
      String(url).endsWith('/models')
        ? new Response(
            JSON.stringify({
              data: [
                {
                  id: 'directory-model',
                  effort: { supported_levels: levels, default_level: 'high' },
                  max_output_tokens: 512,
                },
              ],
            }),
          )
        : reply(),
    );
    const registry = new ModelRegistry(fetcher);
    const client = new ChatCompletionsClient(fetcher, undefined, registry);
    const result = await client.registry.fetchModels(config);
    expect(result.models[0].capabilities).toMatchObject({
      effortLevels: ['high', 'max'],
      defaultEffort: 'high',
      evidence: 'model-directory',
    });
    await expect(
      client.complete(config, 'directory-model', 'low', [], undefined, undefined, undefined, {
        thinking: 'on',
      }),
    ).rejects.toThrow('不支持');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.complete(config, 'directory-model', 'high', []);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[1][1]?.body)).max_tokens).toBe(512);
    levels = ['low', 'high', 'max'];
    await registry.fetchModels(config);
    await client.complete(config, 'directory-model', 'minimal', []);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[3][1]?.body)).reasoning_effort).toBe(
      'low',
    );
    expect(registry.capabilities('https://proxy.invalid', 'directory-model').thinkingOn).toBe(
      'unknown',
    );
  });

  it('keeps per-Agent null inheritance distinct from explicit provider-default and survives saves', async () => {
    const e = quietEngine();
    e.dispatchCommand({
      type: 'configureAgent',
      agentId: 'ops-meridian',
      enabled: true,
      modelConfig: {
        model: 'deepseek-v4-pro',
        thinking: 'off',
        reasoningEffort: 'provider-default',
      },
    });
    e.dispatchCommand({
      type: 'configureAgent',
      agentId: 'ops-horizon',
      enabled: true,
      modelConfig: { model: null, thinking: null, reasoningEffort: null },
    });
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    const f = fixture();
    const global = { ...config, thinking: 'on' as const, reasoningEffort: 'low' as const };
    await askIntent(f.client, global, restored.getObservation('ops-meridian')!);
    await askIntent(f.client, global, restored.getObservation('ops-horizon')!);
    expect(f.bodies[0]).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'disabled' },
      max_tokens: 1800,
    });
    expect(f.bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(f.bodies[1]).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    });
    const changed = { ...global, defaultModel: 'deepseek-v4-pro', reasoningEffort: 'max' as const };
    await askIntent(f.client, changed, restored.getObservation('ops-horizon')!);
    expect(f.bodies[2]).toMatchObject({ model: 'deepseek-v4-pro', reasoning_effort: 'max' });
    restored.dispatchCommand({
      type: 'configureAgent',
      agentId: 'ops-horizon',
      enabled: true,
      modelConfig: {
        model: 'deepseek-flash',
        thinking: 'provider-default',
        reasoningEffort: 'provider-default',
      },
    });
    await askIntent(f.client, changed, restored.getObservation('ops-horizon')!);
    expect(f.bodies[3]).not.toHaveProperty('thinking');
    expect(f.bodies[3]).not.toHaveProperty('reasoning_effort');
    expect(f.tracker.stats().byAgentCostCny?.['ops-horizon']).toBeNull(); // switched model has no configured price
    restored.dispatchCommand({
      type: 'configureAgent',
      agentId: 'ops-horizon',
      enabled: true,
      modelConfig: { model: null, thinking: 'off', reasoningEffort: null },
    });
    await expect(
      askIntent(f.client, changed, restored.getObservation('ops-horizon')!),
    ).rejects.toThrow('不兼容');
    expect(f.bodies).toHaveLength(4);
  });

  it('round trips global settings, budgets and model prices without exposing secrets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'frontier-deepseek-'));
    const vault: SecretVault = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(Buffer.from(value).map((v) => v ^ 0x70)),
      decryptString: (value) => Buffer.from(value.map((v) => v ^ 0x70)).toString(),
    };
    try {
      const store = new AgentConfigStore(directory, vault);
      store.update({ ...config, thinking: 'off', thinkingBudget: 3000, compatibilityRetries: 0 });
      const restored = new AgentConfigStore(directory, vault);
      expect(restored.connection()).toMatchObject({
        ...config,
        thinking: 'off',
        thinkingBudget: 3000,
      });
      expect(restored.publicSettings()).not.toHaveProperty('apiKey');
      expect(readFileSync(join(directory, 'agent-api.v1.json'), 'utf8')).not.toContain(
        config.apiKey,
      );
      store.update({
        baseUrl: config.baseUrl,
        defaultModel: 'deepseek-v4-pro',
        thinking: 'on',
        reasoningEffort: 'max',
        thinkingBudget: 5000,
        modelPricesCny: { 'deepseek-v4-pro': { input: 5, cacheHit: 0.5, output: 10 } },
      });
      expect(new AgentConfigStore(directory, vault).connection()).toMatchObject({
        defaultModel: 'deepseek-v4-pro',
        thinking: 'on',
        reasoningEffort: 'max',
        thinkingBudget: 5000,
      });
      expect(() => store.update({ ...config, thinkingBudget: 32769 })).toThrow();
    } finally {
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup');
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('labels compatibility mappings and offers an explicit conflict resolution in UI', () => {
    expect(deepSeekEffort('minimal')).toBe('low');
    expect(effortLabel(config.baseUrl, 'xhigh', 'XHIGH')).toContain('实际 HIGH');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    let html: string;
    try {
      html = renderToStaticMarkup(
        createElement(LcarsProvider, {
          children: createElement(ReasoningNotice, {
            baseUrl: config.baseUrl,
            thinking: 'off',
            effort: 'medium',
            resetEffort: () => {},
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(html).toContain('默认可能开启 HIGH');
    expect(html).toContain('实际为 high');
    expect(html).toContain('保留 OFF，将 Effort 改为供应商默认');
    expect(html).toContain('role="alert"');
  });
});

describe('paid attempt bounds, truncation usage and RMB telemetry', () => {
  it.each(['format', 'stream', 'reasoning', 'network', 'rate-limit'])(
    'never retries DeepSeek %s failure',
    async (kind) => {
      const f = fixture(() => {
        if (kind === 'network') throw Error('network');
        return new Response(
          'unsupported ' +
            (
              {
                format: 'response_format',
                stream: 'stream',
                reasoning: 'reasoning_effort',
              } as Record<string, string>
            )[kind],
          { status: kind === 'rate-limit' ? 429 : 400 },
        );
      });
      await expect(complete(f, 'on', 'high', { compatibilityRetries: 2 })).rejects.toThrow();
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.tracker.stats().costCny).toBeNull();
    },
  );

  it.each(['not JSON', '{"disposition":"invalid"}'])(
    'invalid decision %s requires manual retry and retains usage',
    async (output) => {
      let valid = false;
      const f = fixture(() => reply(valid ? JSON.stringify(conversation()) : output));
      const observation = quietEngine().getObservation('ops-meridian')!;
      await expect(askIntent(f.client, config, observation)).rejects.toThrow('请手动重试');
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.tracker.stats()).toMatchObject({ repairs: 0, tokens: 1200, costCny: expectedCost });
      valid = true;
      await askIntent(f.client, config, observation);
      expect(f.fetcher).toHaveBeenCalledTimes(2);
      expect(f.tracker.stats().byAgentCostCny?.['ops-meridian']).toBeCloseTo(expectedCost * 2);
    },
  );

  it.each(['json', 'sse', 'http-error', 'envelope-error', 'disconnected'])(
    'preserves returned usage on %s failure',
    async (protocol) => {
      const f = fixture(() => {
        if (protocol === 'sse' || protocol === 'disconnected')
          return new Response(
            'data: ' +
              JSON.stringify({
                choices: [
                  { delta: { content: '{}' }, finish_reason: protocol === 'sse' ? 'length' : null },
                ],
              }) +
              '\n\n' +
              'data: ' +
              JSON.stringify({ choices: [], usage }) +
              '\n\n' +
              (protocol === 'sse' ? 'data: [DONE]\n\n' : ''),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        if (protocol === 'http-error')
          return new Response(JSON.stringify({ error: { code: 'server_error' }, usage }), {
            status: 500,
          });
        if (protocol === 'envelope-error') return reply('', { error: { code: 'server_error' } });
        return reply('{}', { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] });
      });
      await expect(complete(f, 'on', 'high')).rejects.toThrow();
      expect(f.tracker.stats()).toMatchObject({
        tokens: 1200,
        costCny: expectedCost,
        concurrency: 0,
        requests: 1,
      });
      expect(f.tracker.stats().recentRequests[0]).toMatchObject({
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 150,
        cacheHitTokens: 600,
        cacheMissTokens: 400,
        costCny: expectedCost,
        phase: 'failed',
      });
    },
  );

  it('missing usage/prices stay unknown; reasoning is not charged twice and secrets are absent', async () => {
    const f = fixture(() =>
      reply('', {
        choices: [
          {
            message: { content: '{"ok":true}', reasoning_content: 'private chain of thought' },
            finish_reason: 'stop',
          },
        ],
      }),
    );
    await complete(f, 'on', 'high');
    expect(f.tracker.stats().costCny).toBeCloseTo(expectedCost);
    await complete(f, 'on', 'high', { modelPricesCny: {} });
    expect(f.tracker.stats()).toMatchObject({
      costCny: null,
      knownCostCny: expectedCost,
      unknownCostRequests: 1,
    });
    const unknown = fixture(() => reply('{}', { usage: undefined }));
    await complete(unknown, 'off', 'provider-default');
    expect(unknown.tracker.stats()).toMatchObject({ costCny: null, tokens: null });
    expect(unknown.tracker.stats().recentRequests[0]).toMatchObject({
      costCny: null,
      inputTokens: null,
    });
    expect(JSON.stringify(f.tracker.stats())).not.toContain('private chain of thought');
    expect(JSON.stringify(f.tracker.stats())).not.toContain(config.apiKey);
  });

  it('unknown providers have no automatic compatibility calls by default', async () => {
    const f = fixture(() => new Response('unsupported response_format', { status: 400 }));
    await expect(
      f.client.complete(
        { ...config, baseUrl: 'https://unknown.invalid', thinking: 'provider-default' },
        'manual',
        'provider-default',
        [],
      ),
    ).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('derives total and cache miss tokens without inventing missing usage', async () => {
    const f = fixture(() =>
      reply('{}', {
        usage: { ...usage, total_tokens: undefined, prompt_cache_miss_tokens: undefined },
      }),
    );
    await complete(f, 'off', 'provider-default');
    expect(f.tracker.stats()).toMatchObject({ tokens: 1200, costCny: expectedCost });
    expect(f.tracker.stats().recentRequests[0].cacheMissTokens).toBeNull();
    const unknownSplit = fixture(() =>
      reply('{}', { usage: { prompt_tokens: 1000, completion_tokens: 200 } }),
    );
    await complete(unknownSplit, 'off', 'provider-default');
    expect(unknownSplit.tracker.stats()).toMatchObject({ tokens: 1200, costCny: null });
  });

  it('reports a failed test JSON while retaining its paid usage', async () => {
    const f = fixture(() => reply('{"ok":false}'));
    await expect(f.client.test(config)).rejects.toThrow('未返回有效测试 JSON');
    expect(f.tracker.stats()).toMatchObject({ failures: 1, requests: 1, costCny: expectedCost });
    expect(f.tracker.stats().recentRequests[0]).toMatchObject({
      phase: 'failed',
      failureKind: 'validation',
    });
  });
});
