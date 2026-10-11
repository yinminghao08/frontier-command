import { askIntent, conversation } from './provider-harness';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ChatCompletionsClient } from '../electron/agents/client';
import { RequestTracker } from '../electron/agents/runtime';
import { AgentDecisionService } from '../electron/agents/service';
import { quietEngine, issue } from './helpers';
import { privateChannel } from '../src/engine/chat';

const config = {
  baseUrl: 'http://127.0.0.1/v1',
  defaultModel: 'local-only',
  reasoningEffort: 'none' as const,
  apiKey: 'isolated-transport-secret',
};
const decision = JSON.stringify(conversation());
const jsonReply = (content = decision) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { total_tokens: 19 },
    }),
  );
const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
const contentEvent = (content: string, finish_reason: string | null = null) =>
  event({ choices: [{ index: 0, delta: { content }, finish_reason }] });
const sse = (content = decision) =>
  ': keepalive\r\n\r\n' +
  contentEvent(content) +
  contentEvent('', 'stop') +
  event({ choices: [], usage: { total_tokens: 19 } }) +
  'data: [DONE]\r\n\r\n';
const servers: Server[] = [];
async function provider(reply: (response: ServerResponse, body: Record<string, unknown>) => void) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (part: Buffer) => {
      body += part.toString();
    });
    request.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      bodies.push(parsed);
      reply(response, parsed);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    config: { ...config, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` },
    bodies,
  };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('streaming and non-streaming provider protocol', () => {
  it('reads SSE one byte at a time, including split UTF-8, CRLF, heartbeats, reasoning and usage', async () => {
    const local = await provider((response) => {
      response.setHeader('Content-Type', 'text/event-stream');
      const text =
        event({ choices: [{ index: 0, delta: { reasoning_content: '这不是最终 JSON' } }] }) + sse();
      for (const byte of Buffer.from(text)) response.write(Buffer.from([byte]));
      response.end();
    });
    // A synthetic byte stream forces boundaries that TCP is free to coalesce.
    const tracker = new RequestTracker();
    const fake: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of Buffer.from(sse())) controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    const result = await askIntent(
      new ChatCompletionsClient(fake, tracker),
      config,
      quietEngine().getObservation('ops-meridian')!,
    );
    expect(result.reply).toContain('舰况良好');
    await askIntent(
      new ChatCompletionsClient(fetch),
      local.config,
      quietEngine().getObservation('ops-meridian')!,
    );
  });

  it('defaults to streaming, accepts JSON responses, and counts usage exactly', async () => {
    const local = await provider((response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ message: { content: decision }, finish_reason: 'stop' }],
          usage: { total_tokens: 19 },
        }),
      );
    });
    const tracker = new RequestTracker();
    await askIntent(
      new ChatCompletionsClient(fetch, tracker),
      local.config,
      quietEngine().getObservation('ops-meridian')!,
    );
    expect(local.bodies[0].stream).toBe(true);
    expect(tracker.stats()).toMatchObject({ concurrency: 0, tokens: 19 });
    expect(tracker.stats().recentRequests[0]).toMatchObject({
      responseFormat: 'json',
      httpStatus: 200,
      finishReason: 'stop',
      choiceCount: 1,
    });
  });

  it('negotiates only stream and JSON format, caches compatibility and preserves reasoning mode', async () => {
    const local = await provider((response, body) => {
      const rejected = body.stream
        ? 'stream'
        : body.reasoning_effort
          ? 'reasoning_effort'
          : body.response_format
            ? 'response_format'
            : null;
      if (rejected) {
        response.writeHead(400);
        response.end('unsupported parameter: ' + rejected);
      } else response.end(JSON.stringify({ choices: [{ message: { content: decision } }] }));
    });
    const client = new ChatCompletionsClient();
    await askIntent(
      client,
      { ...local.config, compatibilityRetries: 2 },
      quietEngine().getObservation('ops-meridian')!,
    );
    expect(local.bodies).toHaveLength(3);
    await askIntent(
      client,
      { ...local.config, compatibilityRetries: 2 },
      quietEngine().getObservation('ops-meridian')!,
    );
    expect(local.bodies).toHaveLength(4);
    expect(local.bodies[3]).toMatchObject({ stream: false });
    expect(local.bodies[3]).not.toHaveProperty('reasoning_effort');
    expect(local.bodies[3]).not.toHaveProperty('response_format');
  });

  it.each([
    [
      'empty',
      JSON.stringify({ choices: [{ message: { content: null, reasoning_content: '思考' } }] }),
      'application/json',
    ],
    ['protocol', JSON.stringify({ choices: [] }), 'application/json'],
    ['provider', JSON.stringify({ error: { message: config.apiKey } }), 'application/json'],
    [
      'truncated',
      JSON.stringify({ choices: [{ message: { content: decision }, finish_reason: 'length' }] }),
      'application/json',
    ],
    ['disconnected', contentEvent(decision), 'text/event-stream'],
    [
      'empty',
      event({ choices: [{ delta: { reasoning_content: '只推理' }, finish_reason: 'stop' }] }) +
        'data: [DONE]\n\n',
      'text/event-stream',
    ],
    ['provider', event({ error: { message: 'bad gateway' } }), 'text/event-stream'],
    ['truncated', contentEvent(decision, 'length'), 'text/event-stream'],
    [
      'credentials',
      contentEvent(config.apiKey.slice(0, 10)) + contentEvent(config.apiKey.slice(10)),
      'text/event-stream',
    ],
    ['oversized', contentEvent('x'.repeat(128001)), 'text/event-stream'],
  ])(
    'classifies %s and never leaks raw response or credentials',
    async (kind, body, contentType) => {
      // The error-with-secret fixture intentionally exercises credential rejection first.
      const expected = body.includes(config.apiKey) && kind === 'provider' ? 'credentials' : kind;
      const local = await provider((response) => {
        response.setHeader('Content-Type', contentType);
        response.end(body);
      });
      const tracker = new RequestTracker();
      await expect(
        askIntent(
          new ChatCompletionsClient(fetch, tracker),
          local.config,
          quietEngine().getObservation('ops-meridian')!,
        ),
      ).rejects.toMatchObject({ kind: expected });
      expect(tracker.stats().recentRequests[0]).toMatchObject({
        phase: 'failed',
        failureKind: expected,
      });
      expect(JSON.stringify(tracker.stats())).not.toContain(config.apiKey);
      expect(tracker.stats().concurrency).toBe(0);
    },
  );

  it.each([401, 429, 502])('classifies HTTP %i safely', async (status) => {
    const local = await provider((response) => {
      response.writeHead(status);
      response.end(config.apiKey);
    });
    const tracker = new RequestTracker();
    await expect(
      new ChatCompletionsClient(fetch, tracker).test(local.config),
    ).rejects.toMatchObject({
      kind: status === 401 ? 'authentication' : status === 429 ? 'rate-limit' : 'provider',
    });
    expect(JSON.stringify(tracker.stats())).not.toContain(config.apiKey);
  });

  it('accepts mislabeled SSE and stop-completed streams without DONE', async () => {
    const local = await provider((response) => response.end(contentEvent(decision, 'stop')));
    const tracker = new RequestTracker();
    await askIntent(
      new ChatCompletionsClient(fetch, tracker),
      local.config,
      quietEngine().getObservation('ops-meridian')!,
    );
    expect(tracker.stats().recentRequests[0].responseFormat).toBe('sse');
  });
});

describe('no application deadline and cancellation authority', () => {
  it('connection timeout is configurable; defaults to 30 seconds; active streams have only an idle deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const tracker = new RequestTracker();
    const pending = askIntent(
      new ChatCompletionsClient(async () => {
        await new Promise<void>((r) => setTimeout(r, 65000));
        return jsonReply();
      }, tracker),
      { ...config, connectionTimeoutMs: 90000 },
      quietEngine().getObservation('ops-meridian')!,
    );
    await vi.advanceTimersByTimeAsync(65000);
    await expect(pending).resolves.toHaveProperty('proposal', null);
    const timeout = new ChatCompletionsClient(async () => new Promise(() => {}), tracker)
      .test(config)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await timeout).toMatchObject({ kind: 'network' });
    expect(tracker.stats().concurrency).toBe(0);
    const controller = new AbortController();
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const flowing = new ChatCompletionsClient(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              const pulse = () => {
                stream.enqueue(Buffer.from(': progress\n\n'));
                timer = setTimeout(pulse, 90000);
              };
              pulse();
            },
            cancel() {
              stopped = true;
              clearTimeout(timer);
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      tracker,
    )
      .test(config, controller.signal)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(600000);
    expect(tracker.stats().concurrency).toBe(1);
    controller.abort();
    expect(await flowing).toMatchObject({ kind: 'cancelled' });
    expect(stopped).toBe(true);
    expect(tracker.stats()).toMatchObject({ concurrency: 0, cancellations: 1, failures: 1 });
  });

  it.each(['cancel', 'message', 'takeover', 'disable', 'model', 'dispose'] as const)(
    '%s discards late output and closes even an uncooperative body reader',
    async (change) => {
      const e = quietEngine();
      e.state.agents[0].enabled = false;
      e.dispatchCommand({
        type: 'sendChat',
        channelId: privateChannel('ops-meridian'),
        content: '报告情况',
        mentions: [],
      });
      const message = e.state.chatMessages.find((m) => m.sender === 'commander')!;
      let release: (() => void) | undefined;
      let cancelled = false;
      const tracker = new RequestTracker();
      let calls = 0;
      const client = new ChatCompletionsClient(async () => {
        calls++;
        if (calls > 1) return jsonReply(JSON.stringify(conversation('这是新的有效决策')));
        return new Response(
          new ReadableStream({
            start(controller) {
              release = () => {
                if (!cancelled) {
                  controller.enqueue(Buffer.from(sse()));
                  controller.close();
                }
              };
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }, tracker);
      const service = new AgentDecisionService(
        {
          snapshot: () => e.snapshot(),
          cognitionPort: (id) => e.cognitionPort(id),
          command: (c, id) => e.dispatchCommand(c, id),
          validate: (c, id) => e.validate(c, id),
        },
        () => config,
        client,
      );
      service.pump();
      await flush();
      const revision = e.state.agents[1].decision.revision;
      if (change === 'cancel')
        e.dispatchCommand({
          type: 'cancelAgentReply',
          agentId: 'ops-meridian',
          messageId: message.id,
        });
      if (change === 'message')
        e.dispatchCommand({
          type: 'sendChat',
          channelId: privateChannel('ops-meridian'),
          content: '替代上一条',
          mentions: [],
        });
      if (change === 'takeover') issue(e, { type: 'MOVE', point: { x: 0, y: 0 } }, 'meridian');
      if (change === 'disable' || change === 'model')
        e.dispatchCommand({
          type: 'configureAgent',
          agentId: 'ops-meridian',
          enabled: change !== 'disable',
          modelConfig: { model: 'changed', reasoningEffort: null },
        });
      if (change !== 'dispose')
        expect(e.state.agents[1].decision.revision).toBeGreaterThan(revision);
      // Pump must cancel obsolete revisions; disposal models world/API replacement.
      if (change === 'dispose') service.dispose();
      else service.pump();
      await flush();
      release!();
      await flush();
      expect(cancelled).toBe(true);
      expect(
        e.state.chatMessages.some(
          (m) => m.origin === 'agent' && m.replyTo === message.id && m.content.includes('舰况良好'),
        ),
      ).toBe(false);
      expect(tracker.stats()).toMatchObject({ concurrency: 0, cancellations: 1 });
      expect(tracker.stats().recentRequests.some((r) => r.phase === 'cancelled')).toBe(true);
      service.dispose();
    },
  );
});
