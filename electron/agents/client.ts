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
import { abortable, readCompletion, httpError, AgentApiError } from './transport';
export { AgentApiError } from './transport';
import {
  taskJudgmentSchema,
  taskJudgmentJsonSchema,
  taskJudgmentContext,
  TASK_JUDGMENT_PROMPT,
} from './task-judgment';
interface RequestContext {
  startedAt: number;
  agentId: string;
  kind: RequestKind;
}

const SYSTEM_PROMPT = `你是 Frontier Command 的独立 Agent。依据公开上下文和自己的性格判断，只返回 JSON。
格式：{"goal":"目标","rationale":"简短理由","action":null,"messages":[],"memory":null,"waitMinutes":30,"coordination":null}。
玩家消息必须在原频道回复，messages 每条包含 channelId、content、mentions、replyTo。说明现在要做什么或真实拒绝原因，不反复道歉，不捏造执行结果、库存、舰船ID、ETA或引擎限制。当前任务随时可以修改；补充指令继承已有路线与货物。已接受的任务由引擎执行，不重复下令。
action 使用 actionExamples 的格式，参数可按真实条件调整；HAUL 未指定数量使用 loadPolicy=auto 尽量满载。INTERCEPT 只负责截获，摧毁需要 ATTACK。自主行为遵守 ROE，明确 Admiral 任务使用 answerTask 接受或拒绝，action=null。普通聊天不擅自变成新任务。
协作：coordination 可为 requestTask(kind,agentId,action,followUp,conditions)、answerRequest(requestId,version,response,conditions,reason)、answerTask(taskId,version,response,conditions,reason)；response=accept/reject/counter/withdraw，reason=risk/fatigue/damage/conflict/preference/relationship/promise。只回答轮到自己的请求。
waitMinutes=5..180；memory=null 或简短记忆。无玩家新消息且无新事实时 messages=[]。不得使用隐藏情报或直接修改世界、属性。`;

export interface CompletionResult {
  content: string;
  reasoningFallback: boolean;
  formatFallback: boolean;
}
export class ChatCompletionsClient {
  private readonly compatibility = new Map<
    string,
    { format: 'schema' | 'object' | 'text'; reasoning: boolean; stream: boolean }
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
  ): Promise<CompletionResult> {
    if (!config.apiKey)
      throw new AgentApiError('Agent API 未配置 Key，请在控制台设置中配置后重试。');
    let timing: AgentRequestTiming | undefined;
    let release: (() => void) | undefined;
    const network = requestContext ?? {
      startedAt: Date.now(),
      agentId: 'admiral:test',
      kind: 'test' as const,
    };
    const signal = externalSignal ?? new AbortController().signal;
    const capabilityKey = config.baseUrl + '\n' + model;
    const cached = this.compatibility.get(capabilityKey);
    let reasoning = effort !== 'none' && cached?.reasoning !== false,
      format: 'schema' | 'object' | 'text' = schema
        ? (cached?.format ?? 'object')
        : cached?.format === 'text'
          ? 'text'
          : 'object',
      reasoningFallback = effort !== 'none' && cached?.reasoning === false,
      formatFallback = format === 'text',
      stream = cached?.stream !== false;
    const endpoint = config.baseUrl.replace(/\/+$/, '').endsWith('/chat/completions')
      ? config.baseUrl.replace(/\/+$/, '')
      : config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        signal.throwIfAborted();
        if (this.tracker)
          release = await this.tracker.acquire(
            network.agentId,
            attempt > 0 ? 'compatibility' : network.kind,
            signal,
          );
        const requestBody = JSON.stringify({
          model,
          messages,
          stream,
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
          network.startedAt,
        );
        const pending = this.fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
          body: requestBody,
        });
        // A late fetch result must close its body even if fetch ignored cancellation.
        void pending.then(
          (response) => {
            if (signal.aborted) void response.body?.cancel().catch(() => {});
          },
          () => {},
        );
        const response = await abortable(pending, signal);
        signal.throwIfAborted();
        const result = await readCompletion(response, signal, config.apiKey, timing);
        if (timing) {
          timing.endedAt = Date.now();
          timing.phase = response.ok ? 'completed' : 'failed';
          timing.reason = response.ok ? null : 'HTTP ' + response.status;
          timing.failureKind = response.ok ? null : httpError(response.status).kind;
        }
        release?.();
        release = undefined;
        if (result.unsupported) {
          if (result.unsupported.reasoning && reasoning) {
            reasoning = false;
            reasoningFallback = true;
          } else if (result.unsupported.format && format !== 'text') {
            format = format === 'schema' ? 'object' : 'text';
            formatFallback = true;
          } else if (result.unsupported.stream && stream) {
            stream = false;
          } else throw httpError(response.status);
          this.compatibility.set(capabilityKey, {
            format,
            reasoning: !reasoningFallback && cached?.reasoning !== false,
            stream,
          });
          continue;
        }
        this.tracker?.usage(result.usage);
        this.compatibility.set(capabilityKey, {
          format,
          reasoning: !reasoningFallback && cached?.reasoning !== false,
          stream,
        });
        return {
          content: result.content,
          reasoningFallback,
          formatFallback,
        };
      }
      throw new AgentApiError('Provider 不支持所请求参数，兼容重试失败。');
    } catch (error) {
      const failure = signal.aborted
        ? new AgentApiError('模型请求已取消。', 'cancelled')
        : error instanceof AgentApiError
          ? error
          : new AgentApiError('无法连接 Agent API，请检查网络与 Base URL。', 'network');
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
      release?.();
    }
  }
  async judgeTask(
    config: ConnectionConfig,
    observation: Observation,
    signal?: AbortSignal,
    refresh?: () => Observation | null,
    validate?: (decision: AgentDecision) => { ok: boolean; reason: string },
  ): Promise<AgentDecision> {
    const task = observation.admiralTask;
    if (!task || !observation.self) throw new AgentApiError('任务判断缺少有效任务。');
    const network: RequestContext = {
      startedAt: Date.now(),
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
        signal?.throwIfAborted();
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
  ): Promise<AgentDecision> {
    const decisionSignal = signal;
    const network: RequestContext = {
      startedAt: Date.now(),
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
          signal?.throwIfAborted();
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
        (result.reasoningFallback
          ? ' · Provider 不支持 reasoning_effort，已兼容省略'
          : config.reasoningEffort === 'none'
            ? ' · NONE：未发送推理参数'
            : ' · ' + config.reasoningEffort.toUpperCase()) +
        (result.formatFallback ? ' · Provider 使用文本 JSON 兼容模式' : ''),
    };
  }
}
