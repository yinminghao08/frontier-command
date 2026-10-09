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
import type { AgentRequestTiming } from '../../src/engine/agent-api';
import { abortable, readCompletion, httpError, AgentApiError } from './transport';
export { AgentApiError } from './transport';
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
    } = {},
  ): Promise<CompletionResult> {
    if (!config.apiKey) throw new AgentApiError('Agent API 未配置 Key。', 'authentication');
    const registry = new ModelRegistry(this.fetcher),
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
    const cached = this.compatibility.get(key);
    let format: 'schema' | 'tool' | 'object' | 'text' =
      cached?.format ??
      (schema && cap.strictSchema === 'supported'
        ? 'schema'
        : /dashscope/.test(new URL(config.baseUrl).hostname) &&
            cap.thinkingOn === 'supported' &&
            reasoning.enable_thinking !== false
          ? 'text'
          : 'object');
    let stream = cached?.stream !== false,
      formatFallback = false;
    let timing: AgentRequestTiming | undefined, release: (() => void) | undefined;
    for (
      let compatibilityAttempt = 0;
      compatibilityAttempt <= 2 && budget.used < 4;
      compatibilityAttempt++
    ) {
      if (externalSignal?.aborted) throw new AgentApiError('模型请求已取消。', 'cancelled');
      budget.used++;
      const controller = new AbortController(),
        cancel = () => controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener('abort', cancel, { once: true });
      if (externalSignal?.aborted) cancel();
      let timedOut = false;
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
        const reasoningBudget = cap.thinkingOn === 'supported' && effectiveThinking !== 'off';
        const maxTokens = reasoningBudget
          ? Math.max(8192, options.outputBudget ?? 900)
          : (options.outputBudget ?? 1200);
        const body = JSON.stringify({
          model,
          messages: [
            ...messages,
            ...(schema && ['object', 'text'].includes(format)
              ? [
                  {
                    role: 'system',
                    content: '当前决策仅允许此 JSON Schema：' + JSON.stringify(schema),
                  },
                ]
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
          if (compatibilityAttempt >= 2) throw httpError(response.status);
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
          this.compatibility.set(key, { format, reasoning: true, stream });
          continue;
        }
        this.tracker?.usage(result.usage, timing);
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
    for (let repair = 0; repair < 2 && attempts.used < 4; repair++) {
      network.kind = repair ? 'repair' : 'initial';
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
      messages.push({
        role: 'user',
        content: '只修复 JSON 格式或字段：' + issue + '。不要改变目标和授权，不生成 Action。',
      });
    }
    this.tracker?.failure();
    throw new AgentApiError('格式修复失败，未提交任何决定：' + issue, 'validation');
  }
  async test(config: ConnectionConfig, signal?: AbortSignal) {
    const result = await this.complete(
      config,
      config.defaultModel,
      config.reasoningEffort,
      [
        { role: 'system', content: 'Reply only JSON: {"ok":true}' },
        { role: 'user', content: 'API connectivity test. Reply JSON.' },
      ],
      signal,
    );
    try {
      if (JSON.parse(result.content).ok !== true) throw Error();
    } catch {
      throw new AgentApiError('API 已连接，但未返回有效测试 JSON。');
    }
    return {
      ok: true,
      reason:
        'API 可用 · ' +
        config.defaultModel +
        ' · Thinking/Effort 沿用配置' +
        (result.formatFallback ? ' · 输出协议使用文本 JSON 兼容模式' : ''),
    };
  }
}
