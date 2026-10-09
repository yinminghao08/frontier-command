import { describe, expect, it } from 'vitest';
import { quietEngine } from './helpers';
import { privateChannel } from '../src/engine/chat';
import { ChatCompletionsClient } from '../electron/agents/client';
import { taskJudgmentContext } from '../electron/agents/task-judgment';
import { AgentDecisionService } from '../electron/agents/service';
import { issue } from './helpers';
const config = {
  baseUrl: 'http://127.0.0.1/v1',
  defaultModel: 'short-model',
  reasoningEffort: 'none' as const,
  apiKey: 'isolated-task-key',
};
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
  e.dispatchCommand({ type: 'interpretInteraction', agentId: id, messageId: e.state.nextChat - 1 });
  return { e, id };
}
const reply = (value: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
async function flush() {
  for (let i = 0; i < 12; i++) await new Promise<void>((done) => setImmediate(done));
}
describe('short LLM task judgments', () => {
  it('a delayed judgment cannot overwrite an explicit takeover', async () => {
    const { e } = taskEngine();
    let finish: (() => void) | undefined;
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (a) => e.controllerPort(a),
        command: (c, a) => e.dispatchCommand(c, a),
        validate: (c, a) => e.validate(c, a),
      },
      () => config,
      new ChatCompletionsClient(async () => {
        await new Promise<void>((done) => {
          finish = done;
        });
        return reply({ accept: true, reason: 'preference', rationale: '可以巡逻' });
      }),
    );
    service.pump();
    await flush();
    issue(e, { type: 'REST', targetId: 'base', duration: 30 }, 'meridian');
    service.pump();
    finish!();
    await flush();
    expect(e.state.objectives[0].status).toBe('interrupted');
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('REST');
    service.dispose();
  });
  it('rejects JSON-escaped credentials before they enter any judgment feedback', async () => {
    const { e, id } = taskEngine();
    const content = JSON.stringify({
      accept: true,
      reason: 'preference',
      rationale: config.apiKey,
    }).replace(
      config.apiKey,
      Array.from(
        config.apiKey,
        (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
      ).join(''),
    );
    const client = new ChatCompletionsClient(
      async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })),
    );
    await expect(client.judgeTask(config, e.getObservation(id)!)).rejects.toThrow('凭据');
    expect(JSON.stringify(e.state)).not.toContain(config.apiKey);
  });
  it('sends only task facts with a short schema and preserves the selected model and NONE', async () => {
    const { e, id } = taskEngine(),
      bodies: Record<string, unknown>[] = [];
    const client = new ChatCompletionsClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return reply(
        body.messages[0].content.startsWith('TASK_JUDGMENT:')
          ? { accept: true, reason: 'preference', rationale: '当前状态允许巡逻' }
          : { goal: '等待', rationale: '没有新情况', action: null },
      );
    });
    const o = e.getObservation(id)!;
    const d = await client.judgeTask(config, o);
    await client.decide(config, o);
    expect(JSON.stringify(bodies[0]).length).toBeLessThan(JSON.stringify(bodies[1]).length / 3);
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[0].model).toBe(o.self?.modelConfig.model ?? config.defaultModel);
    expect(taskJudgmentContext(o)).not.toHaveProperty('recentChat');
    expect(taskJudgmentContext(o)).not.toHaveProperty('opportunities');
    expect(d.coordination).toMatchObject({
      type: 'answerTask',
      response: 'accept',
      conditions: [],
    });
    expect(d.messages).toMatchObject([
      { channelId: privateChannel(id), replyTo: e.state.objectives[0].messageId },
    ]);
    expect(e.state.chatMessages.some((m) => m.content.includes('等待自主判断'))).toBe(false);
  });
  it('an actual model refusal cancels the task and gives its reason without executing', async () => {
    const { e, id } = taskEngine();
    let calls = 0;
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        controllerPort: (a) => e.controllerPort(a),
        command: (c, a) => e.dispatchCommand(c, a),
        validate: (c, a) => e.validate(c, a),
      },
      () => config,
      new ChatCompletionsClient(async () => {
        calls++;
        return reply({ accept: false, reason: 'fatigue', rationale: '需要先休息' });
      }),
    );
    service.pump();
    await flush();
    expect(calls).toBe(1);
    expect(e.state.objectives[0]).toMatchObject({
      consent: 'rejected',
      status: 'cancelled',
      rounds: 0,
    });
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current).toBeNull();
    expect(e.state.chatMessages.some((m) => m.content === '拒绝任务：需要先休息')).toBe(true);
    expect(e.state.agents.find((a) => a.id === id)!.decision.lastError).toBeNull();
    service.pump();
    await flush();
    expect(calls).toBe(1);
    service.dispose();
  });
  it('one malformed judgment is corrected without switching to full decisions or negotiations', async () => {
    const { e, id } = taskEngine();
    let calls = 0;
    const client = new ChatCompletionsClient(async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0].content).toMatch(/^TASK_JUDGMENT:/);
      return reply(
        calls === 1
          ? { response: 'counter', conditions: [] }
          : { accept: false, reason: 'risk', rationale: '风险过高' },
      );
    });
    const d = await client.judgeTask(config, e.getObservation(id)!);
    expect(calls).toBe(2);
    expect(d.coordination).toMatchObject({ response: 'reject', conditions: [] });
  });
});
