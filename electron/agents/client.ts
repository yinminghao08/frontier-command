import { z } from 'zod';
import { agentDecisionSchema } from '../../src/engine/commands';
import {
  decisionJsonSchema,
  decisionIssues,
  normalizeDecision,
} from '../../src/engine/decision-protocol';
import type { AgentDecision, Observation, ReasoningEffort } from '../../src/engine/types';
import type { ConnectionConfig } from './config';
import { RequestTracker, type RequestKind } from './runtime';
import type { AgentRequestTiming } from '../../src/engine/agent-api';
import { compactObservation } from './context';
import {
  taskJudgmentSchema,
  taskJudgmentJsonSchema,
  taskJudgmentContext,
  TASK_JUDGMENT_PROMPT,
} from './task-judgment';
interface NetworkBudget {
  remaining: number;
  deadlineAt?: number;
  agentId: string;
  kind: RequestKind;
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
const SYSTEM_PROMPT = `你是 Frontier Command 的独立 Agent。依据公开上下文和自己的性格判断，只返回 JSON。
格式：{"goal":"目标","rationale":"简短理由","action":null,"messages":[],"memory":null,"waitMinutes":30,"coordination":null}。
玩家消息必须在原频道回复，messages 每条包含 channelId、content、mentions、replyTo。说明现在要做什么或真实拒绝原因，不反复道歉，不捏造执行结果、库存、舰船ID、ETA或引擎限制。当前任务随时可以修改；补充指令继承已有路线与货物。已接受的任务由引擎执行，不重复下令。
action 使用 actionExamples 的格式，参数可按真实条件调整；HAUL 未指定数量使用 loadPolicy=auto 尽量满载。INTERCEPT 只负责截获，摧毁需要 ATTACK。自主行为遵守 ROE，明确 Admiral 任务使用 answerTask 接受或拒绝，action=null。普通聊天不擅自变成新任务。
协作：coordination 可为 requestTask(kind,agentId,action,followUp,conditions)、answerRequest(requestId,version,response,conditions,reason)、answerTask(taskId,version,response,conditions,reason)；response=accept/reject/counter/withdraw，reason=risk/fatigue/damage/conflict/preference/relationship/promise。只回答轮到自己的请求。
waitMinutes=5..180；memory=null 或简短记忆。无玩家新消息且无新事实时 messages=[]。不得使用隐藏情报或直接修改世界、属性。`;

/** Release callers at the deadline even if a provider's fetch/body ignores abort. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? Error('aborted'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export class AgentApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentApiError';
  }
}
export interface CompletionResult {
  content: string;
  reasoningFallback: boolean;
  formatFallback: boolean;
}
export class ChatCompletionsClient {
  private readonly compatibility = new Map<
    string,
    { format: 'schema' | 'object' | 'text'; reasoning: boolean }
  >();
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20000,
    private readonly tracker?: RequestTracker,
  ) {}
  async complete(
    config: ConnectionConfig,
    model: string,
    effort: ReasoningEffort,
    messages: { role: string; content: string }[],
    externalSignal?: AbortSignal,
    schema?: Record<string, unknown>,
    networkBudget?: NetworkBudget,
  ): Promise<CompletionResult> {
    if (!config.apiKey)
      throw new AgentApiError('Agent API 未配置 Key，请在控制台设置中配置后重试。');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timing: AgentRequestTiming | undefined;
    let release: (() => void) | undefined;
    const network = networkBudget ?? {
      remaining: this.timeoutMs,
      agentId: 'admiral:test',
      kind: 'test' as const,
    };
    network.deadlineAt ??= Date.now() + network.remaining;
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    const capabilityKey = config.baseUrl + '\n' + model;
    const cached = this.compatibility.get(capabilityKey);
    let reasoning = effort !== 'none' && cached?.reasoning !== false,
      format: 'schema' | 'object' | 'text' = schema
        ? (cached?.format ?? 'object')
        : cached?.format === 'text'
          ? 'text'
          : 'object',
      reasoningFallback = effort !== 'none' && cached?.reasoning === false,
      formatFallback = format === 'text';
    const endpoint = config.baseUrl.replace(/\/+$/, '').endsWith('/chat/completions')
      ? config.baseUrl.replace(/\/+$/, '')
      : config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        network.remaining = network.deadlineAt - Date.now();
        if (network.remaining <= 0) throw new AgentApiError('模型调用超时，请稍后重试。');
        if (this.tracker)
          release = await this.tracker.acquire(
            network.agentId,
            attempt > 0 ? 'compatibility' : network.kind,
            signal,
          );
        const started = Date.now();
        timer = setTimeout(() => controller.abort(), network.remaining);
        const requestBody = JSON.stringify({
          model,
          messages,
          stream: false,
          ...(reasoning ? { reasoning_effort: effort } : {}),
          ...(format === 'schema' && schema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'frontier_agent_decision', strict: true, schema },
                },
              }
            : format === 'object'
              ? { response_format: { type: 'json_object' } }
              : {}),
        });
        timing = this.tracker?.track(
          network.agentId,
          attempt ? 'compatibility' : network.kind,
          Buffer.byteLength(requestBody),
          network.deadlineAt,
        );
        const response = await abortable(
          this.fetcher(endpoint, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + config.apiKey,
            },
            body: requestBody,
          }),
          signal,
        );
        signal.throwIfAborted();
        // Provider bodies may echo secrets. Never log/return them, including on HTTP errors.
        const reader = response.body?.getReader();
        let body = '',
          size = 0;
        if (reader) {
          const decoder = new TextDecoder();
          for (;;) {
            const part = await abortable(reader.read(), signal);
            signal.throwIfAborted();
            if (part.done) break;
            if (timing && timing.firstByteAt === null) {
              timing.firstByteAt = Date.now();
              timing.phase = 'receiving';
            }
            size += part.value.byteLength;
            if (size > 128000) {
              void reader.cancel().catch(() => {});
              throw new AgentApiError('模型响应过大，已拒绝。');
            }
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        }
        network.remaining = network.deadlineAt - Date.now();
        if (timing) {
          timing.endedAt = Date.now();
          timing.phase = response.ok ? 'completed' : 'failed';
          timing.reason = response.ok ? null : 'HTTP ' + response.status;
        }
        clearTimeout(timer);
        timer = undefined;
        release?.();
        release = undefined;
        if (!response.ok) {
          const unsupported =
            [400, 422].includes(response.status) &&
            /unsupported|unknown|unrecognized|not supported|not permitted|not allowed|extra|does not support|无效|不支持/i.test(
              body,
            );
          if (unsupported && reasoning && /reasoning[_ ]effort/i.test(body)) {
            reasoning = false;
            reasoningFallback = true;
            this.compatibility.set(capabilityKey, { format, reasoning: false });
            continue;
          }
          if (
            unsupported &&
            format !== 'text' &&
            /response[_ ]format|json_object|json_schema/i.test(body)
          ) {
            format = format === 'schema' ? 'object' : 'text';
            formatFallback = true;
            this.compatibility.set(capabilityKey, {
              format,
              reasoning: cached?.reasoning !== false && !reasoningFallback,
            });
            continue;
          }
          throw new AgentApiError(
            response.status === 401 || response.status === 403
              ? 'API 认证失败，请检查 Key 与模型权限。'
              : response.status === 429
                ? 'API 额度或频率限制，请稍后重试。'
                : 'API 请求失败（HTTP ' + response.status + '），请检查地址、模型和设置。',
          );
        }
        if (body.includes(config.apiKey))
          throw new AgentApiError('Provider 响应包含凭据，已拒绝并保护记录。');
        let data: unknown;
        try {
          data = JSON.parse(body);
        } catch {
          throw new AgentApiError('API 响应不是有效 JSON。');
        }
        const parsed = completionSchema.safeParse(data);
        if (!parsed.success) throw new AgentApiError('API 响应缺少有效 choices/message/content。');
        if (parsed.data.choices[0].message.content.includes(config.apiKey))
          throw new AgentApiError('Provider 响应包含凭据，已拒绝并保护记录。');
        this.tracker?.usage(
          data && typeof data === 'object' && 'usage' in data ? data.usage : undefined,
        );
        return {
          content: parsed.data.choices[0].message.content,
          reasoningFallback,
          formatFallback,
        };
      }
      throw new AgentApiError('Provider 不支持所请求参数，兼容重试失败。');
    } catch (error) {
      if (timing) {
        timing.endedAt = Date.now();
        timing.phase = 'failed';
        timing.reason =
          error instanceof AgentApiError
            ? error.message
            : signal.aborted
              ? '超时或取消'
              : '网络失败';
      }
      if (externalSignal?.aborted) this.tracker?.cancellation();
      else this.tracker?.failure();
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError(
        signal.aborted
          ? '模型调用超时或已取消，请稍后重试。'
          : '无法连接 Agent API，请检查网络与 Base URL。',
      );
    } finally {
      clearTimeout(timer);
      release?.();
    }
  }
  async judgeTask(
    config: ConnectionConfig,
    observation: Observation,
    signal?: AbortSignal,
    refresh?: () => Observation | null,
    validate?: (decision: AgentDecision) => { ok: boolean; reason: string },
    deadlineAt?: number,
  ): Promise<AgentDecision> {
    const task = observation.admiralTask;
    if (!task || !observation.self) throw new AgentApiError('任务判断缺少有效任务。');
    const network: NetworkBudget = {
      remaining: this.timeoutMs,
      deadlineAt: Math.min(deadlineAt ?? Infinity, Date.now() + this.timeoutMs),
      agentId: observation.operatorId,
      kind: 'initial',
    };
    const messages = [
      { role: 'system', content: TASK_JUDGMENT_PROMPT },
      { role: 'user', content: JSON.stringify(taskJudgmentContext(observation)) },
    ];
    let issue = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      network.kind = attempt ? 'repair' : 'initial';
      const current = refresh?.() ?? observation;
      const result = await this.complete(
        config,
        current.self?.modelConfig.model ?? config.defaultModel,
        current.self?.modelConfig.reasoningEffort ?? config.reasoningEffort,
        messages,
        signal,
        taskJudgmentJsonSchema,
        network,
      );
      let json: unknown;
      try {
        json = JSON.parse(
          result.content
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, ''),
        );
      } catch {
        issue = '非法 JSON';
      }
      if (json !== undefined && JSON.stringify(json).includes(config.apiKey))
        throw new AgentApiError('Provider 响应包含凭据，已拒绝并保护记录。');
      const parsed = taskJudgmentSchema.safeParse(json);
      if (parsed.success) {
        const decision = agentDecisionSchema.parse({
          goal: parsed.data.accept ? '执行 Admiral 任务' : '拒绝 Admiral 任务',
          rationale: parsed.data.rationale,
          action: null,
          messages: [
            {
              channelId: task.channelId,
              content: parsed.data.reply ?? parsed.data.rationale,
              mentions: [],
              replyTo: task.messageId,
            },
          ],
          coordination: {
            type: 'answerTask',
            taskId: task.id,
            version: task.conditionVersion,
            response: parsed.data.accept ? 'accept' : 'reject',
            conditions: [],
            reason: parsed.data.reason,
          },
        });
        const validationStart = Date.now();
        const checked = validate?.(decision);
        this.tracker?.validation(observation.operatorId, Date.now() - validationStart);
        if (Date.now() >= network.deadlineAt!)
          throw new AgentApiError('模型调用超时，决策未执行，请重试。');
        if (!checked || checked.ok) return decision;
        issue = checked.reason;
      } else issue = decisionIssues(parsed.error);
      this.tracker?.rejected(observation.operatorId, issue);
      if (attempt === 0)
        messages.push({
          role: 'user',
          content:
            '判断未执行，请只纠正此问题：' +
            issue +
            '。无法合法执行时拒绝；只返回 accept、reason、rationale。',
        });
    }
    this.tracker?.failure();
    throw new AgentApiError('任务判断纠错失败：' + issue + '；任务未执行。');
  }
  async decide(
    config: ConnectionConfig,
    observation: Observation,
    signal?: AbortSignal,
    refresh?: () => Observation | null,
    validate?: (decision: AgentDecision) => { ok: boolean; reason: string },
    deadlineAt?: number,
  ): Promise<AgentDecision> {
    const decisionSignal = signal;
    const network: NetworkBudget = {
      remaining: this.timeoutMs,
      deadlineAt: Math.min(deadlineAt ?? Infinity, Date.now() + this.timeoutMs),
      agentId: observation.operatorId,
      kind: 'initial',
    };
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      { role: 'user', content: JSON.stringify(compactObservation(observation)) },
    ];
    let lastIssue = '';
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        network.kind = attempt ? 'repair' : 'initial';
        const current = refresh?.() ?? observation;
        const result = await this.complete(
          config,
          current.self?.modelConfig.model ?? config.defaultModel,
          current.self?.modelConfig.reasoningEffort ?? config.reasoningEffort,
          messages,
          decisionSignal,
          decisionJsonSchema,
          network,
        );
        let json: unknown;
        try {
          json = JSON.parse(
            result.content
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/, ''),
          );
        } catch {
          lastIssue = 'decision: 非法 JSON，请只返回一个 JSON 对象';
        }
        if (json !== undefined) {
          if (JSON.stringify(json).includes(config.apiKey))
            throw new AgentApiError('Provider 响应包含凭据，已拒绝并保护记录。');
          const parsed = agentDecisionSchema.safeParse(normalizeDecision(json));
          if (parsed.success) {
            const parent = current.recentChat.find(
              (m) => m.responses?.[current.operatorId] === 'pending',
            );
            if (parent) {
              const reply = parsed.data.messages.find((m) => m.channelId === parent.channelId);
              if (reply) reply.replyTo = parent.id;
              else
                parsed.data.messages.push({
                  channelId: parent.channelId,
                  content: parsed.data.rationale,
                  mentions: [],
                  replyTo: parent.id,
                  purpose: 'information',
                });
            }
            const validationStart = Date.now();
            const validation = validate?.(parsed.data);
            this.tracker?.validation(observation.operatorId, Date.now() - validationStart);
            if (Date.now() >= network.deadlineAt!)
              throw new AgentApiError('模型调用超时，决策未执行，请重试。');
            if (!validation || validation.ok) return parsed.data;
            lastIssue = '动作校验：' + validation.reason;
          } else lastIssue = 'schema 校验：' + decisionIssues(parsed.error);
        }
        this.tracker?.rejected(observation.operatorId, lastIssue);
        if (attempt < 1)
          messages.splice(
            0,
            messages.length,
            {
              role: 'system',
              content: SYSTEM_PROMPT + '\n上次决策未执行，请纠正：' + lastIssue.slice(0, 500),
            },
            {
              role: 'user',
              content: JSON.stringify(compactObservation(refresh?.() ?? observation)),
            },
          );
      }
      this.tracker?.failure();
      throw new AgentApiError('决策纠错重试耗尽：' + lastIssue + '；未执行任何动作。');
    } finally {
      // Every HTTP attempt shares the same network deadline.
    }
  }
  async test(config: ConnectionConfig) {
    const result = await this.complete(config, config.defaultModel, config.reasoningEffort, [
      { role: 'system', content: 'Reply only JSON: {"ok":true}' },
      { role: 'user', content: 'API connectivity test. Reply JSON.' },
    ]);
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
        (result.reasoningFallback
          ? ' · Provider 不支持 reasoning_effort，已兼容省略'
          : config.reasoningEffort === 'none'
            ? ' · NONE：未发送推理参数'
            : ' · ' + config.reasoningEffort.toUpperCase()) +
        (result.formatFallback ? ' · Provider 使用文本 JSON 兼容模式' : ''),
    };
  }
}
