import type {
  CapabilityStatus,
  ModelCapabilities,
  ModelInfo,
  ModelsResult,
} from '../../src/engine/agent-api';
export type {
  CapabilityStatus,
  ModelCapabilities,
  ModelInfo,
  ModelsResult,
} from '../../src/engine/agent-api';
import type { ThinkingMode } from '../../src/engine/types';
export type { ThinkingMode } from '../../src/engine/types';
import type { ConnectionConfig } from './config';
import { AgentApiError, abortable, httpError } from './transport';
import { z } from 'zod';

export const providerEndpoints = (baseUrl: string) => {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  const root = url.href.replace(/\/+$/, '');
  return {
    chat: root + '/chat/completions',
    models: root + '/models',
    alternateModels: /\/v\d+$/.test(url.pathname) ? null : root + '/v1/models',
  };
};
const unknown = (): ModelCapabilities => ({
  thinkingOn: 'unknown',
  thinkingOff: 'unknown',
  reasoningEffort: 'unknown',
  strictSchema: 'unknown',
  jsonObject: 'unknown',
  toolCalling: 'unknown',
  streaming: 'unknown',
  evidence: 'unknown',
});
/** The model directory is metadata, not evidence for reasoning capabilities. */
export class ModelRegistry {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  capabilities(baseUrl: string, model: string): ModelCapabilities {
    const host = new URL(baseUrl).hostname;
    if (host === 'api.openai.com') {
      // Endpoint-specific: these models support structured text in Chat
      // Completions, but require Responses for tool calling.
      if (['gpt-6.1-sol', 'gpt-6-astra'].includes(model))
        return {
          thinkingOn: 'supported',
          thinkingOff: 'unsupported',
          reasoningEffort: 'supported',
          strictSchema: 'supported',
          jsonObject: 'supported',
          toolCalling: 'unsupported',
          streaming: 'supported',
          evidence: 'official-documentation',
        };
      const structured = [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'gpt-5',
        'gpt-5-mini',
        'gpt-5-nano',
        'gpt-5.1',
        'gpt-5.2',
      ];
      if (structured.includes(model)) {
        const reasoning = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2'].includes(
          model,
        );
        return {
          thinkingOn: reasoning ? 'supported' : 'unsupported',
          thinkingOff: ['gpt-5.1', 'gpt-5.2'].includes(model) ? 'supported' : 'unsupported',
          reasoningEffort: reasoning ? 'supported' : 'unsupported',
          strictSchema: 'supported',
          jsonObject: 'supported',
          toolCalling: 'supported',
          streaming: 'supported',
          evidence: 'official-documentation',
        };
      }
    }
    if (
      /(^|\.)dashscope\.(?:aliyuncs\.com|intl\.aliyuncs\.com)$/.test(host) &&
      ['qwen3-32b', 'qwen3-30b-a3b', 'qwen3-235b-a22b', 'qwen3-8b', 'qwen3-14b'].includes(model)
    )
      return {
        ...unknown(),
        thinkingOn: 'supported',
        thinkingOff: 'supported',
        reasoningEffort: 'unsupported',
        jsonObject: 'supported',
        streaming: 'supported',
        evidence: 'official-documentation',
      };
    return unknown();
  }
  reasoningParameters(
    baseUrl: string,
    model: string,
    thinking: ThinkingMode,
    effort: string,
  ): Record<string, string | boolean> {
    const cap = this.capabilities(baseUrl, model),
      explicitEffort = !['none', 'provider-default'].includes(effort);
    if (thinking === 'provider-default' && !explicitEffort) return {};
    if (thinking === 'off') {
      if (explicitEffort)
        throw new AgentApiError(
          'Thinking OFF 与显式推理强度不兼容；请选择默认强度。',
          'validation',
        );
      if (cap.thinkingOff !== 'supported')
        throw new AgentApiError(
          '此模型的 Thinking OFF 能力' +
            (cap.thinkingOff === 'unknown' ? '尚未确认' : '不受支持') +
            '，未发送请求。',
          'validation',
        );
    }
    if (thinking === 'on' && cap.thinkingOn !== 'supported')
      throw new AgentApiError(
        '此模型的 Thinking ON 能力尚未确认或不受支持，未发送请求。',
        'validation',
      );
    if (explicitEffort && cap.reasoningEffort !== 'supported')
      throw new AgentApiError(
        '此模型不支持或尚未确认 Reasoning Effort，未发送请求。',
        'validation',
      );
    if (new URL(baseUrl).hostname === 'api.openai.com') {
      if (thinking === 'off') return { reasoning_effort: 'none' };
      const allowed = ['gpt-6.1-sol', 'gpt-6-astra'].includes(model)
        ? ['low', 'medium', 'high', 'xhigh', 'max']
        : model === 'gpt-5.2'
          ? ['none', 'low', 'medium', 'high', 'xhigh']
          : model === 'gpt-5.1'
            ? ['none', 'low', 'medium', 'high']
            : ['minimal', 'low', 'medium', 'high'];
      const effective = explicitEffort ? effort : 'medium';
      if (!allowed.includes(effective))
        throw new AgentApiError('所选模型不支持此推理强度，未发送请求。', 'validation');
      return { reasoning_effort: effective };
    }
    return { enable_thinking: thinking !== 'off' };
  }
  async fetchModels(config: ConnectionConfig, signal?: AbortSignal): Promise<ModelsResult> {
    if (!config.apiKey)
      return {
        ok: false,
        models: [],
        reason: '请先配置 API Key；模型 ID 仍可手动输入。',
        directory: 'unknown',
      };
    const controller = new AbortController(),
      parentAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', parentAbort, { once: true });
    if (signal?.aborted) parentAbort();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const paths = providerEndpoints(config.baseUrl);
    try {
      for (const url of [paths.models, paths.alternateModels].filter(
        (url): url is string => url !== null,
      )) {
        const pending = this.fetcher(url, {
          headers: { Authorization: 'Bearer ' + config.apiKey },
          redirect: 'error',
          signal: controller.signal,
        });
        void pending.then(
          (response) => {
            if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          },
          () => {},
        );
        const response = await abortable(pending, controller.signal);
        if ([404, 405, 501].includes(response.status)) {
          await response.body?.cancel();
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw httpError(response.status);
        }
        const bytes = await abortable(response.text(), controller.signal);
        if (bytes.length > 2000000 || bytes.includes(config.apiKey))
          throw new AgentApiError('模型目录内容无法安全读取。', 'protocol');
        let data: unknown;
        try {
          data = JSON.parse(bytes);
        } catch {
          throw new AgentApiError('模型目录不是有效 JSON。', 'protocol');
        }
        if (JSON.stringify(data).includes(config.apiKey))
          throw new AgentApiError('模型目录包含凭据，已拒绝并保护记录。', 'credentials');
        const models = z
          .object({ data: z.array(z.object({ id: z.string().min(1).max(120) })).max(10000) })
          .safeParse(data);
        if (!models.success)
          throw new AgentApiError('Provider 模型目录格式不受支持；可手动输入模型 ID。', 'protocol');
        return {
          ok: true,
          models: [...new Set(models.data.data.map((m) => m.id))]
            .sort()
            .map((id) => ({ id, capabilities: this.capabilities(config.baseUrl, id) })),
          reason: '已获取模型目录；目录本身不证明推理和输出能力。',
          directory: 'supported',
        };
      }
      return {
        ok: false,
        models: [],
        reason: 'Provider 不提供兼容模型目录；可继续手动输入模型 ID。',
        directory: 'unsupported',
      };
    } catch (error) {
      return {
        ok: false,
        models: [],
        reason:
          error instanceof AgentApiError
            ? error.message
            : '模型目录连接失败或超时；可手动输入模型 ID。',
        directory: 'unknown',
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', parentAbort);
    }
  }
}
