import { ModelRegistry, providerEndpoints } from './model-registry';
import {
  cognitionSchemas,
  cognitionResponseSchema,
  type CognitionRequest,
  type CognitionResponse,
} from '../../src/engine/cognition-protocol';
import { decisionIssues } from '../../src/engine/structured-output';
import type { ReasoningEffort } from '../../src/engine/types';
import type { ConnectionConfig } from './config';
import { RequestTracker, type RequestKind } from './runtime';
import type { AgentRequestTiming, ModelCapabilities } from '../../src/engine/agent-api';
import { abortable, readCompletion, httpError, AgentApiError } from './transport';
import { isDeepSeek } from '../../src/engine/deepseek';
export { AgentApiError } from './transport';
export function requestPolicy(
  config: ConnectionConfig,
  model: string,
  thinkingSource: 'provider-default' | 'on' | 'off',
  parameters: Record<string, unknown>,
  cap: ModelCapabilities,
  purpose?: string,
  outputBudget?: number,
  generationBudget?: number,
): NonNullable<AgentRequestTiming['effective']> {
  const switchValue = parameters.thinking as { type?: string } | undefined;
  const thinking =
    switchValue?.type === 'disabled' ||
    parameters.enable_thinking === false ||
    parameters.reasoning_effort === 'none'
      ? 'off'
      : switchValue?.type === 'enabled' ||
          parameters.enable_thinking === true ||
          parameters.reasoning_effort
        ? 'on'
        : (cap.defaultThinking ?? 'unknown');
  const outputLimit = purpose === 'intent' ? 1800 : 900;
  const purposeScale =
    purpose === 'communication'
      ? 0.5
      : purpose === 'judgment' || purpose === 'collaboration'
        ? 0.75
        : 1;
  const requested =
    generationBudget ??
    (thinking === 'on'
      ? (config.thinkingBudget ?? 4096) * purposeScale
      : Math.min(outputBudget ?? outputLimit, outputLimit));
  if (!Number.isFinite(requested) || requested < 1)
    throw new AgentApiError('生成 Token 预算必须是正数。', 'validation');
  return {
    provider: new URL(config.baseUrl).hostname,
    model,
    thinking,
    thinkingSource,
    effort:
      typeof parameters.reasoning_effort === 'string'
        ? parameters.reasoning_effort
        : thinking === 'off'
          ? 'none'
          : cap.defaultEffort
            ? `${cap.defaultEffort} (provider-default)`
            : 'provider-default (unknown)',
    maxTokens: Math.max(1, Math.floor(Math.min(requested, 32768, cap.maxOutputTokens ?? 32768))),
  };
}
interface RequestContext {
  startedAt: number;
  agentId: string;
  kind: RequestKind;
  purpose?: string;
}

export interface CompletionResult {
  content: string;
  reasoningFallback: boolean;
  formatFallback: boolean;
}
export class ChatCompletionsClient {
  private readonly compatibility = new Map<
    string,
    { format: 'schema' | 'tool' | 'object' | 'text'; reasoning: boolean; stream: boolean }
  >();
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly tracker?: RequestTracker,
    readonly registry = new ModelRegistry(fetcher),
  ) {}
  async complete(
    config: ConnectionConfig,
    model: string,
    effort: ReasoningEffort,
    messages: { role: string; content: string }[],
    externalSignal?: AbortSignal,
    schema?: Record<string, unknown>,
    requestContext?: RequestContext,
    options: {
      onPhase?: (phase: 'receiving' | 'validating') => void;
      thinking?: 'provider-default' | 'on' | 'off';
      outputBudget?: number;
      attempts?: { used: number };
      generationBudget?: number;
      stream?: boolean;
    } = {},
  ): Promise<CompletionResult> {
    if (!config.apiKey) throw new AgentApiError('Agent API 未配置 Key。', 'authentication');
    const registry = this.registry,
      cap = registry.capabilities(config.baseUrl, model);
    const effectiveThinking = options.thinking ?? config.thinking ?? 'provider-default';
    const reasoning = registry.reasoningParameters(
      config.baseUrl,
      model,
      effectiveThinking,
      effort,
    );
    const network = requestContext ?? {
      startedAt: Date.now(),
      agentId: 'admiral:test',
      kind: 'test' as const,
    };
    const budget = options.attempts ?? { used: 0 },
      key = config.baseUrl + '\n' + model;
    const cached = isDeepSeek(config.baseUrl) ? undefined : this.compatibility.get(key);
    let format: 'schema' | 'tool' | 'object' | 'text' =
      cached?.format ??
      (schema && cap.strictSchema === 'supported'
        ? 'schema'
        : /dashscope/.test(new URL(config.baseUrl).hostname) &&
            cap.thinkingOn === 'supported' &&
            reasoning.enable_thinking !== false
          ? 'text'
          : 'object');
    let stream = options.stream ?? cached?.stream !== false,
      formatFallback = false;
    let timing: AgentRequestTiming | undefined, release: (() => void) | undefined;
    const retries = isDeepSeek(config.baseUrl)
      ? 0
      : Math.min(2, Math.max(0, config.compatibilityRetries ?? 0));
    const effective = requestPolicy(
      config,
      model,
      effectiveThinking,
      reasoning,
      cap,
      network.purpose,
      options.outputBudget,
      options.generationBudget,
    );
    for (
      let compatibilityAttempt = 0;
      compatibilityAttempt <= retries && budget.used < 3;
      compatibilityAttempt++
    ) {
      if (externalSignal?.aborted) throw new AgentApiError('模型请求已取消。', 'cancelled');
      budget.used++;
      timing = undefined;
      const controller = new AbortController(),
        cancel = () => controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener('abort', cancel, { once: true });
      if (externalSignal?.aborted) cancel();
      let timedOut = false;
      let usageRecorded = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.connectionTimeoutMs ?? 30000);
      try {
        if (this.tracker)
          release = await this.tracker.acquire(
            network.agentId,
            compatibilityAttempt ? 'compatibility' : network.kind,
            controller.signal,
          );
        const maxTokens = effective.maxTokens;
        const body = JSON.stringify({
          model,
          messages: [
            ...messages,
            ...(schema && ['object', 'text'].includes(format)
              ? [
                  {
                    role: 'system',
                    content: '只返回 JSON，当前决策仅允许此 JSON Schema：' + JSON.stringify(schema),
                  },
                ]
              : []),
            ...(format === 'object' && !schema
              ? [{ role: 'system', content: 'Return only valid JSON.' }]
              : []),
          ],
          stream,
          ...reasoning,
          ...(new URL(config.baseUrl).hostname === 'api.openai.com'
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens }),
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          ...(format === 'tool' && schema
            ? {
                tools: [
                  {
                    type: 'function',
                    function: {
                      name: 'frontier_decision',
                      description: 'Submit this one purpose decision.',
                      strict: true,
                      parameters: schema,
                    },
                  },
                ],
                tool_choice: { type: 'function', function: { name: 'frontier_decision' } },
                parallel_tool_calls: false,
              }
            : {}),
          ...(format === 'schema' && schema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'frontier_' + network.kind, strict: true, schema },
                },
              }
            : format === 'object'
              ? { response_format: { type: 'json_object' } }
              : {}),
        });
        timing = this.tracker?.track(
          network.agentId,
          (network.purpose ? network.purpose + ' / ' : '') +
            (compatibilityAttempt ? 'compatibility' : network.kind),
          Buffer.byteLength(body),
          network.startedAt,
        );
        if (timing) {
          timing.effective = effective;
          timing.priceCny = config.modelPricesCny?.[model];
        }
        const pending = this.fetcher(providerEndpoints(config.baseUrl).chat, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
          body,
        });
        void pending.then(
          (response) => {
            if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          },
          () => {},
        );
        const response = await abortable(pending, controller.signal);
        clearTimeout(timeout);
        if (timing) timing.connectedAt = Date.now();
        const result = await readCompletion(
          response,
          controller.signal,
          config.apiKey,
          timing,
          config.idleTimeoutMs ?? 120000,
          () => options.onPhase?.('receiving'),
          (usage) => {
            usageRecorded = true;
            this.tracker?.usage(usage, timing);
          },
        );
        controller.signal.throwIfAborted();
        if (timing) {
          timing.endedAt = Date.now();
          timing.generationEndedAt = timing.endedAt;
          timing.phase = response.ok ? 'completed' : 'failed';
          timing.reason = response.ok ? null : 'HTTP ' + response.status;
          timing.failureKind = response.ok ? null : httpError(response.status).kind;
        }
        release?.();
        release = undefined;
        if (!response.ok) {
          if (result.unsupported?.reasoning)
            throw new AgentApiError(
              'Provider 拒绝所选推理设置；未改动 Thinking 或 Effort，请调整配置。',
              'validation',
            );
          if (compatibilityAttempt >= retries) throw httpError(response.status);
          if (result.unsupported?.format && format !== 'text') {
            format =
              format === 'schema' && schema && cap.toolCalling === 'supported'
                ? 'tool'
                : format === 'tool'
                  ? 'object'
                  : 'text';
            formatFallback = true;
          } else if (result.unsupported?.stream && stream) stream = false;
          else throw httpError(response.status);
          if (options.stream === undefined)
            this.compatibility.set(key, { format, reasoning: true, stream });
          continue;
        }
        if (options.stream === undefined)
          this.compatibility.set(key, { format, reasoning: true, stream });
        return { content: result.content, reasoningFallback: false, formatFallback };
      } catch (error) {
        const failure = timedOut
          ? new AgentApiError('连接 Provider 超时。', 'network')
          : externalSignal?.aborted
            ? new AgentApiError('模型请求已取消。', 'cancelled')
            : error instanceof AgentApiError
              ? error
              : new AgentApiError('无法连接 Agent API。', 'network');
        if (timing) {
          timing.endedAt = Date.now();
          timing.phase = failure.kind === 'cancelled' ? 'cancelled' : 'failed';
          timing.reason = failure.message;
          timing.failureKind = failure.kind;
        }
        if (failure.kind === 'cancelled') this.tracker?.cancellation();
        else this.tracker?.failure();
        throw failure;
      } finally {
        if (!usageRecorded && timing) this.tracker?.usage(undefined, timing);
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', cancel);
        release?.();
        release = undefined;
      }
    }
    throw new AgentApiError('达到 HTTP 尝试上限，未提交决策。', 'protocol');
  }
  async cognize(
    config: ConnectionConfig,
    request: CognitionRequest,
    modelConfig: {
      model: string | null;
      reasoningEffort: ReasoningEffort | null;
      thinking?: 'provider-default' | 'on' | 'off' | null;
    },
    signal: AbortSignal,
    onPhase?: (phase: 'receiving' | 'validating') => void,
  ): Promise<CognitionResponse> {
    const messages = [
      { role: 'system', content: request.prompt + ' 只返回符合当前 Schema 的 JSON。' },
      { role: 'user', content: JSON.stringify(request.context) },
    ];
    const attempts = { used: 0 },
      network: RequestContext = {
        startedAt: Date.now(),
        agentId: request.agentId,
        kind: 'initial',
        purpose: request.purpose,
      };
    let issue = '';
    {
      const result = await this.complete(
        config,
        modelConfig.model ?? config.defaultModel,
        modelConfig.reasoningEffort ?? config.reasoningEffort,
        messages,
        signal,
        request.schema,
        network,
        {
          thinking: modelConfig.thinking ?? config.thinking,
          outputBudget: request.outputBudget,
          attempts,
          onPhase,
        },
      );
      let value: unknown;
      try {
        value = JSON.parse(
          result.content
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, ''),
        );
      } catch {
        issue = '非法 JSON';
      }
      if (value !== undefined && JSON.stringify(value).includes(config.apiKey))
        throw new AgentApiError('Provider 响应包含凭据，已拒绝并保护记录。', 'credentials');
      onPhase?.('validating');
      this.tracker?.validating(request.agentId);
      const start = Date.now(),
        parsed = cognitionSchemas[request.purpose].safeParse(value);
      this.tracker?.validation(request.agentId, Date.now() - start);
      signal.throwIfAborted();
      if (parsed.success) {
        this.tracker?.validated(request.agentId);
        return cognitionResponseSchema.parse({ purpose: request.purpose, decision: parsed.data });
      }
      if (value !== undefined) issue = decisionIssues(parsed.error);
      this.tracker?.rejected(request.agentId, issue);
    }
    this.tracker?.failure();
    throw new AgentApiError(
      'JSON / Schema 校验失败，未提交任何决定：' + issue + '。未自动再次调用；请手动重试。',
      'validation',
    );
  }
  async test(
    config: ConnectionConfig,
    signal?: AbortSignal,
    mode: 'connection' | 'configuration' = 'connection',
  ) {
    const cheap = mode === 'connection';
    const cap = this.registry.capabilities(config.baseUrl, config.defaultModel);
    const testConfig = cheap
      ? {
          ...config,
          reasoningEffort: 'provider-default' as const,
          thinking:
            cap.thinkingOff === 'supported' ? ('off' as const) : ('provider-default' as const),
        }
      : config;
    const result = await this.complete(
      testConfig,
      config.defaultModel,
      testConfig.reasoningEffort,
      [
        { role: 'system', content: 'Reply only JSON: {"ok":true}' },
        { role: 'user', content: 'API connectivity test. Reply JSON.' },
      ],
      signal,
      undefined,
      {
        startedAt: Date.now(),
        agentId: 'admiral:test',
        kind: 'test',
        purpose: cheap ? 'connection-test' : 'configuration-test',
      },
      cheap ? { generationBudget: 64, stream: false } : {},
    );
    try {
      if (JSON.parse(result.content).ok !== true) throw Error();
    } catch {
      this.tracker?.rejected('admiral:test', 'API 已连接，但未返回有效测试 JSON。');
      this.tracker?.failure();
      throw new AgentApiError('API 已连接，但未返回有效测试 JSON。');
    }
    return {
      ok: true,
      reason:
        'API 可用 · ' +
        config.defaultModel +
        (cheap
          ? ' · 低成本连接测试：64 Token 上限；未验证真实 Thinking/Effort 配置'
          : ' · 真实配置验证：Thinking/Effort 沿用配置') +
        (result.formatFallback ? ' · 输出协议使用文本 JSON 兼容模式' : ''),
    };
  }
}
