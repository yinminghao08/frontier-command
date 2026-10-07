import { z } from 'zod';
import { agentDecisionSchema } from '../../src/engine/commands';
import type { AgentDecision, Observation, ReasoningEffort } from '../../src/engine/types';
import type { ConnectionConfig } from './config';

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
const SYSTEM_PROMPT = `你是 Frontier Command 的独立 Agent。根据公开 observation 作出高层决策，回复且仅回复一个 JSON 对象。
格式：{"goal":"当前目标","rationale":"简短理由","action":null,"messages":[],"memory":null,"waitMinutes":30,"coordination":null}。
action 为 observation.actionExamples 所示格式的合法游戏 Action，也可以为 null；目标、数量、航线可以根据公开库存与信息调整。职业只是偏好，不是行动白名单。不能虚构 ID、库存、敌人或地图。
你拥有稳定的 personality、skills、experience、trust、fatigue、morale、relationships。根据这些、近期聊天和 memory 作出个性化选择；Admiral 的明确舰船指令优先，legalActions 为空时只能交流/等待。
messages 最多3条，每条 {"channelId":"公开会话ID","content":"消息内容","mentions":["对方Agent ID"]}。Admiral 私聊应在同一私聊答复，群里可 @姓名 联系同僚。聊天应实际影响 goal 与行动，而不是泛泛寒暄。不要在消息里重复系统自动发送的任务完成报告。
Logistics 专长：主动查看 opportunities、inventories、logisticsNeeds，选择真正有货且有需求的 HAUL。已装货可 UNLOAD。repeat=true 需要 logistics 升级；引擎负责装货、航行和卸货。根据 journeys 的 ETA/风险和 wormholes 的已确认出口选航线；引擎自动执行 Warp→TRANSIT→Warp。不可利用未确认出口。
风险高时可以请求护航：coordination={"type":"requestEscort","agentId":"同僚ID","targetShipId":"自己的舰船ID"}。通常 action=null 等待答复，随后选择 HAUL。不要对已 pending/accepted 的请求重复申请。
Battle 专长：保护运输与设施、巡逻、INTERCEPT、ATTACK、DRIVE_OFF、撤退或维修。仅已确认敌对对象可自主交战，Romulan 未确认敌对时应观察或 HAIL。遵守 ROE、己方状态、边境权限。
对发给自己的 pending 护航请求，必须判断自己状态/性格/关系并答复：coordination={"type":"answerEscort","requestId":"请求ID","accept":true/false}。接受时 action 必须为 {"type":"ESCORT","targetId":"请求中的targetShipId"}，拒绝时解释原因，可以另选合法行动。接受/拒绝会改变实际关系。
ESCORT、循环 HAUL 等长任务仍可在 danger/chat 决策节点改变意图；不要在已执行任务时无故重复下令。疲劳很高或损伤严重时考虑撤退、维修、停靠、休息。action=null 不会自动取消当前行动；要中止请选择 RETREAT/DOCK 等行动。
waitMinutes 为5到180的下次空闲复查游戏分钟。memory 为最多300字的要点或null，不能要求直接修改世界。`;

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
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 45000,
  ) {}
  async complete(
    config: ConnectionConfig,
    model: string,
    effort: ReasoningEffort,
    messages: { role: string; content: string }[],
    externalSignal?: AbortSignal,
  ): Promise<CompletionResult> {
    if (!config.apiKey)
      throw new AgentApiError('Agent API 未配置 Key，请在控制台设置中配置后重试。');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    let reasoning = effort !== 'none',
      format = true,
      reasoningFallback = false,
      formatFallback = false;
    const endpoint = config.baseUrl.replace(/\/+$/, '').endsWith('/chat/completions')
      ? config.baseUrl.replace(/\/+$/, '')
      : config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await this.fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            ...(reasoning ? { reasoning_effort: effort } : {}),
            ...(format ? { response_format: { type: 'json_object' } } : {}),
          }),
        });
        // Provider bodies may echo secrets. Never log/return them, including on HTTP errors.
        const reader = response.body?.getReader();
        let body = '',
          size = 0;
        if (reader) {
          const decoder = new TextDecoder();
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 128000) {
              await reader.cancel();
              throw new AgentApiError('模型响应过大，已拒绝。');
            }
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        }
        if (!response.ok) {
          const unsupported =
            [400, 422].includes(response.status) &&
            /unsupported|unknown|unrecognized|not supported|not permitted|not allowed|extra|does not support|无效|不支持/i.test(
              body,
            );
          if (unsupported && reasoning && /reasoning[_ ]effort/i.test(body)) {
            reasoning = false;
            reasoningFallback = true;
            continue;
          }
          if (unsupported && format && /response[_ ]format|json_object/i.test(body)) {
            format = false;
            formatFallback = true;
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
        return {
          content: parsed.data.choices[0].message.content,
          reasoningFallback,
          formatFallback,
        };
      }
      throw new AgentApiError('Provider 不支持所请求参数，兼容重试失败。');
    } catch (error) {
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError(
        signal.aborted
          ? '模型调用超时或已取消，请稍后重试。'
          : '无法连接 Agent API，请检查网络与 Base URL。',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async decide(
    config: ConnectionConfig,
    observation: Observation,
    signal?: AbortSignal,
  ): Promise<AgentDecision> {
    const result = await this.complete(
      config,
      observation.self?.modelConfig.model ?? config.defaultModel,
      observation.self?.modelConfig.reasoningEffort ?? config.reasoningEffort,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(observation) },
      ],
      signal,
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
      throw new AgentApiError('模型返回非法 JSON，决策已拒绝。');
    }
    const parsed = agentDecisionSchema.safeParse(json);
    if (!parsed.success) throw new AgentApiError('模型决策未通过 schema 校验，未执行任何动作。');
    return parsed.data;
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
