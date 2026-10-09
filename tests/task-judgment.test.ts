import { describe, it, expect } from 'vitest';
import { quietEngine, issue } from './helpers';
import { privateChannel } from '../src/engine/chat';
import { ChatCompletionsClient } from '../electron/agents/client';
import { AgentDecisionService } from '../electron/agents/service';
const config = {
  baseUrl: 'http://127.0.0.1/v1',
  defaultModel: 'short-model',
  reasoningEffort: 'provider-default' as const,
  apiKey: 'isolated-task-key',
};
const result = (value: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const judgment = (response: 'accept' | 'reject' = 'accept', reply = '当前状态允许巡逻') => ({
  response,
  reason: 'preference',
  reply,
  conditions: [],
});
async function flush() {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r));
}
function taskEngine() {
  const e = quietEngine(),
    id = 'ops-meridian';
  e.state.agents[0].enabled = false;
  e.dispatchCommand({
    type: 'sendChat',
    channelId: privateChannel(id),
    content: '巡逻基地 5 分钟',
    mentions: [],
  });
  return { e, id };
}
function service(e: ReturnType<typeof quietEngine>, client: ChatCompletionsClient) {
  return new AgentDecisionService(
    {
      snapshot: () => e.snapshot(),
      cognitionPort: (id) => e.cognitionPort(id),
      command: (c, id) => e.dispatchCommand(c, id),
      validate: (c, id) => e.validate(c, id),
    },
    () => config,
    client,
  );
}
describe('purpose-specific TaskJudgment', () => {
  it('a delayed judgment cannot overwrite an explicit takeover', async () => {
    const { e } = taskEngine();
    let release: () => void = () => {};
    const runtime = service(
      e,
      new ChatCompletionsClient(async () => {
        await new Promise<void>((r) => (release = r));
        return result(judgment());
      }),
    );
    runtime.pump();
    await flush();
    issue(e, { type: 'REST', targetId: 'base', duration: 30 }, 'meridian');
    runtime.pump();
    release();
    await flush();
    expect(e.state.objectives[0].status).toBe('interrupted');
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('REST');
    runtime.dispose();
  });
  it('rejects JSON-escaped credentials before judgment feedback', async () => {
    const { e, id } = taskEngine(),
      request = e.cognition.prepare(id)!;
    const escaped = JSON.stringify(judgment('accept', config.apiKey)).replace(
      config.apiKey,
      Array.from(config.apiKey, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(
        '',
      ),
    );
    const client = new ChatCompletionsClient(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: escaped } }] })),
    );
    await expect(
      client.cognize(
        config,
        request,
        e.state.agents.find((a) => a.id === id)!.modelConfig,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'credentials' });
    expect(JSON.stringify(e.state)).not.toContain(config.apiKey);
  });
  it('sends only judgment facts and its own schema, preserving model and provider-default reasoning', async () => {
    const { e, id } = taskEngine(),
      request = e.cognition.prepare(id)!,
      bodies: Record<string, unknown>[] = [];
    const client = new ChatCompletionsClient(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return result(judgment());
    });
    const response = await client.cognize(
      config,
      request,
      e.state.agents.find((a) => a.id === id)!.modelConfig,
      new AbortController().signal,
    );
    expect(request.purpose).toBe('judgment');
    expect(request.context).not.toHaveProperty('recentChat');
    expect(request.context).not.toHaveProperty('opportunities');
    expect(JSON.stringify(request.schema)).not.toContain('"action"');
    expect(JSON.stringify(request.schema)).not.toContain('"coordination"');
    expect(JSON.stringify(bodies)).not.toContain('ATTACK_SET');
    expect(bodies[0].model).toBe('short-model');
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(response).toMatchObject({
      purpose: 'judgment',
      decision: { response: 'accept', conditions: [] },
    });
  });
  it('a refusal produces one primary reason with zero physical execution or automatic retry', async () => {
    const { e, id } = taskEngine();
    let calls = 0;
    const runtime = service(
      e,
      new ChatCompletionsClient(async () => {
        calls++;
        return result({ ...judgment('reject', '需要先休息'), reason: 'fatigue' });
      }),
    );
    runtime.pump();
    await flush();
    expect(calls).toBe(1);
    expect(e.state.objectives[0]).toMatchObject({
      consent: 'rejected',
      status: 'cancelled',
      rounds: 0,
    });
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current).toBeNull();
    const parent = e.state.chatMessages.find((m) => m.sender === 'commander')!;
    expect(
      e.state.chatMessages
        .filter((m) => m.sender === id && m.replyTo === parent.id)
        .map((m) => m.content),
    ).toEqual(['需要先休息']);
    expect(e.state.agents.find((a) => a.id === id)!.decision.lastError).toBeNull();
    runtime.pump();
    await flush();
    expect(calls).toBe(1);
    runtime.dispose();
  });
  it('repairs one malformed judgment without changing purpose or exposing Actions', async () => {
    const { e, id } = taskEngine(),
      request = e.cognition.prepare(id)!;
    let calls = 0;
    const client = new ChatCompletionsClient(async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0].content).toMatch(/^TaskJudgment:/);
      return result(
        calls === 1 ? { response: 'counter', conditions: [] } : judgment('reject', '风险过高'),
      );
    });
    const response = await client.cognize(
      config,
      request,
      e.state.agents.find((a) => a.id === id)!.modelConfig,
      new AbortController().signal,
    );
    expect(calls).toBe(2);
    expect(response).toMatchObject({
      purpose: 'judgment',
      decision: { response: 'reject', conditions: [] },
    });
  });
});
