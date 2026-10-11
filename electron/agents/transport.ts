import { z } from 'zod';
import type { AgentRequestTiming, AgentFailureKind } from '../../src/engine/agent-api';

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly kind: AgentFailureKind = 'validation',
  ) {
    super(message);
    this.name = 'AgentApiError';
  }
}

/** Cancellation must settle even when a provider ignores the signal. */
export function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', aborted);
    const aborted = () => {
      cleanup();
      reject(new AgentApiError('模型请求已取消。', 'cancelled'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

const toolsSchema = z
  .array(
    z.object({
      index: z.number().int().optional(),
      type: z.string().optional(),
      function: z
        .object({ name: z.string().optional(), arguments: z.string().optional() })
        .optional(),
    }),
  )
  .max(1);
const envelopeSchema = z.object({
  error: z.unknown().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().int().optional(),
        message: z
          .object({ content: z.string().nullable().optional(), tool_calls: toolsSchema.optional() })
          .optional(),
        delta: z
          .object({ content: z.string().nullable().optional(), tool_calls: toolsSchema.optional() })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z.unknown().optional(),
});
const safeFinish = (value: string | null | undefined): AgentRequestTiming['finishReason'] =>
  value === 'stop' ||
  value === 'length' ||
  value === 'content_filter' ||
  value === 'tool_calls' ||
  value === 'function_call'
    ? value
    : value
      ? 'other'
      : null;

export function httpError(status: number): AgentApiError {
  return status === 401 || status === 403
    ? new AgentApiError('API 认证失败，请检查 Key 与模型权限。', 'authentication')
    : status === 429
      ? new AgentApiError('API 额度或频率限制，请稍后重试。', 'rate-limit')
      : new AgentApiError(`API 请求失败（HTTP ${status}），请检查地址、模型和设置。`, 'provider');
}
function providerError(value: unknown): AgentApiError {
  const error = z
    .object({ code: z.union([z.string(), z.number()]).optional(), type: z.string().optional() })
    .safeParse(value);
  const code = error.success ? String(error.data.code ?? error.data.type ?? '') : '';
  if (/^(429|rate_limit_exceeded|insufficient_quota)$/.test(code)) return httpError(429);
  if (/^(401|403|invalid_api_key|authentication_error)$/.test(code)) return httpError(401);
  return new AgentApiError('供应商返回错误，未执行决策。请查看模型调用统计并重试。', 'provider');
}
function protect(value: string, key: string) {
  if (value.includes(key))
    throw new AgentApiError('Provider 响应包含凭据，已拒绝并保护记录。', 'credentials');
}
function parse(
  text: string,
  key: string,
  onUsage?: (value: unknown) => void,
): z.infer<typeof envelopeSchema> {
  protect(text, key);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AgentApiError('API 响应不是有效 JSON。', 'protocol');
  }
  protect(JSON.stringify(value), key);
  if (value && typeof value === 'object' && 'usage' in value && value.usage != null)
    onUsage?.(value.usage);
  const result = envelopeSchema.safeParse(value);
  if (!result.success)
    throw new AgentApiError('API 响应结构无效，无法读取 choices/message/content。', 'protocol');
  if (result.data.error !== undefined && result.data.error !== null)
    throw providerError(result.data.error);
  return result.data;
}
function finish(reason: AgentRequestTiming['finishReason']) {
  if (reason === 'length')
    throw new AgentApiError('模型输出被供应商截断，未执行决策。', 'truncated');
  if (reason && reason !== 'stop' && reason !== 'tool_calls')
    throw new AgentApiError('模型未返回完整文本决策，未执行任何动作。', 'protocol');
}

/** Only safe, finite metadata leaves this reader; raw provider text stays here. */
export async function readCompletion(
  response: Response,
  signal: AbortSignal,
  key: string,
  timing?: AgentRequestTiming,
  idleTimeoutMs = 120000,
  onBody?: () => void,
  onUsage?: (value: unknown) => void,
) {
  const reader = response.body?.getReader();
  const advertisedStream = /text\/event-stream/i.test(response.headers.get('content-type') ?? '');
  if (timing) {
    timing.httpStatus = response.status;
    timing.responseFormat = advertisedStream ? 'sse' : 'json';
  }
  let buffer = '',
    content = '',
    bytes = 0,
    done = false,
    streamed = advertisedStream;
  let reportedBody = false;
  let toolArguments = '',
    toolName = '';
  let usage: unknown;
  let finishReason: AgentRequestTiming['finishReason'] = null;
  let sawChoice = false;
  const consume = (event: string) => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data.trim()) return; // SSE comments/heartbeats.
    if (done) throw new AgentApiError('API 流在结束标记后仍返回数据。', 'protocol');
    if (data.trim() === '[DONE]') {
      done = true;
      return;
    }
    const chunk = parse(data, key, (value) => {
      usage = value;
    });
    if (!chunk.choices) throw new AgentApiError('API 流响应缺少 choices。', 'protocol');
    if (timing) timing.choiceCount = chunk.choices.length;
    const choice = chunk.choices.find((c, index) => (c.index ?? index) === 0);
    if (!choice) return; // A final usage chunk may have choices: [].
    sawChoice = true;
    const tool = choice.delta?.tool_calls?.[0] ?? choice.message?.tool_calls?.[0];
    if (tool) {
      if (tool.index !== undefined && tool.index !== 0)
        throw new AgentApiError('模型返回多个工具调用，未提交。', 'protocol');
      toolArguments += tool.function?.arguments ?? '';
      toolName += tool.function?.name ?? '';
    }
    const fragment = choice.delta?.content ?? choice.message?.content ?? '';
    if ((fragment || toolArguments) && timing && timing.firstContentAt == null)
      timing.firstContentAt = Date.now();
    content += fragment;
    if (Buffer.byteLength(content) + Buffer.byteLength(toolArguments) > 128000)
      throw new AgentApiError('模型响应过大，已拒绝。', 'oversized');
    protect(content, key);
    if (choice.finish_reason) finishReason = safeFinish(choice.finish_reason);
    if (timing) timing.finishReason = finishReason;
    // A length event is followed by a separate usage chunk on many providers.
    // Drain that chunk before rejecting the incomplete decision.
  };
  const drain = () => {
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
  };
  try {
    if (reader) {
      const decoder = new TextDecoder();
      let trailingCR = false;
      const append = (text: string) => {
        // Normalize CRLF even when the pair is split between network chunks.
        if (trailingCR) {
          text = '\r' + text;
          trailingCR = false;
        }
        if (text.endsWith('\r')) {
          trailingCR = true;
          text = text.slice(0, -1);
        }
        buffer += text.replace(/\r\n|\r/g, '\n');
        if (!streamed && response.ok && /^\s*(?:data:|:|event:)/.test(buffer)) {
          streamed = true;
          if (timing) timing.responseFormat = 'sse';
        }
        if (streamed && response.ok) drain();
      };
      for (;;) {
        let idle: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          idle = setTimeout(
            () =>
              reject(new AgentApiError('Provider 数据流空闲超时，未提交决策。', 'disconnected')),
            idleTimeoutMs,
          );
        });
        const part = await Promise.race([abortable(reader.read(), signal), timeout]).finally(() =>
          clearTimeout(idle),
        );
        signal.throwIfAborted();
        if (part.done) break;
        if (timing && timing.firstByteAt === null) {
          timing.firstByteAt = Date.now();
          timing.phase = 'receiving';
        }
        if (!reportedBody) {
          reportedBody = true;
          onBody?.();
        }
        bytes += part.value.byteLength;
        // SSE framing has overhead; final content remains capped at 128KB.
        if (bytes > (streamed && response.ok ? 2000000 : 128000))
          throw new AgentApiError('模型响应过大，已拒绝。', 'oversized');
        append(decoder.decode(part.value, { stream: true }));
        if (done) break;
      }
      append(decoder.decode());
      if (trailingCR) buffer += '\n';
    }
    if (!response.ok) {
      try {
        const value: unknown = JSON.parse(buffer);
        if (value && typeof value === 'object' && 'usage' in value) usage = value.usage;
      } catch {
        /* HTTP errors need not be JSON. */
      }
      const unsupported =
        [400, 422].includes(response.status) &&
        /unsupported|unknown|unrecognized|not supported|not permitted|not allowed|extra|does not support|无效|不支持/i.test(
          buffer,
        );
      return {
        unsupported: {
          reasoning: unsupported && /reasoning[_ ]effort|enable_thinking|thinking/i.test(buffer),
          format:
            unsupported &&
            /response[_ ]format|json_object|json_schema|tool_choice|tools/i.test(buffer),
          stream: unsupported && /\bstream(?:ing)?\b/i.test(buffer),
        },
        content: '',
        usage,
      };
    }
    if (streamed) {
      drain();
      if (buffer.trim()) consume(buffer);
      finish(finishReason);
      if (!done && finishReason !== 'stop' && finishReason !== 'tool_calls')
        throw new AgentApiError('API 回复流中途断开，未收到完整结束标记。', 'disconnected');
      if (!sawChoice) throw new AgentApiError('API 流响应缺少有效 choices。', 'protocol');
    } else {
      const envelope = parse(buffer, key, (value) => {
        usage = value;
      });
      if (timing) timing.choiceCount = envelope.choices?.length ?? 0;
      const choice = envelope.choices?.[0];
      if (!choice?.message)
        throw new AgentApiError('API 响应缺少有效 choices/message/content。', 'protocol');
      finishReason = safeFinish(choice.finish_reason);
      if (timing) timing.finishReason = finishReason;
      finish(finishReason);
      content = choice.message.content ?? '';
      const tool = choice.message.tool_calls?.[0];
      if (tool) {
        toolArguments = tool.function?.arguments ?? '';
        toolName = tool.function?.name ?? '';
      }
      if (content && timing && timing.firstContentAt == null) timing.firstContentAt = Date.now();
    }
    if (toolArguments) {
      if (content.trim() || toolName !== 'frontier_decision' || finishReason !== 'tool_calls')
        throw new AgentApiError('工具响应名称、结束标记或正文不一致，未提交。', 'protocol');
      if (Buffer.byteLength(toolArguments) > 128000)
        throw new AgentApiError('工具响应过大，未提交。', 'oversized');
      content = toolArguments;
    } else if (finishReason === 'tool_calls')
      throw new AgentApiError('工具响应缺少参数。', 'empty');
    if (!content.trim())
      throw new AgentApiError('模型返回空回复或只有推理内容，未执行决策。', 'empty');
    protect(content, key);
    return { content, usage, unsupported: null };
  } catch (error) {
    if (signal.aborted || error instanceof AgentApiError) throw error;
    throw new AgentApiError('API 响应读取中断，请检查网络后重试。', 'disconnected');
  } finally {
    onUsage?.(usage);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
