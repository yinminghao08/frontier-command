import { describe, expect, it } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { makeAgent, registerAgent } from '../src/engine/agents';
import { ChatCompletionsClient } from '../electron/agents/client';
import { agentOutcome } from '../src/engine/agents';
import { appendChat, COMMAND_CHANNEL, REPORT_CHANNEL, privateChannel } from '../src/engine/chat';
import {
  decisionContext,
  decisionWorldKey,
  personalFeedback,
  personalProfile,
} from '../src/engine/personality';
import { parseSave } from '../src/engine/saves';
import { capabilities } from '../src/engine/capabilities';
import type { AgentDecision, TaskCondition } from '../src/engine/types';

const mira = 'ops-meridian',
  talia = 'ops-horizon';
function choose(e: SimulationEngine, id: string, changes: Partial<AgentDecision> = {}) {
  return e.dispatchCommand(
    {
      type: 'agentDecision',
      agentId: id,
      revision: e.state.agents.find((a) => a.id === id)!.decision.revision,
      decision: {
        goal: '完成有条件的真实任务',
        rationale: '评估公开风险、人格及承诺',
        action: null,
        messages: [],
        memory: null,
        waitMinutes: 5,
        coordination: null,
        ...changes,
      },
    },
    id,
  );
}
function propose(e: SimulationEngine, content = '巡逻基地 2 分钟') {
  e.dispatchCommand({ type: 'sendChat', channelId: privateChannel(talia), content, mentions: [] });
  const messageId = [...e.state.chatMessages]
    .reverse()
    .find((m) => m.sender === e.state.commander.id)!.id;
  expect(e.dispatchCommand({ type: 'admiralChatTask', agentId: talia, messageId }).ok).toBe(true);
  return e.state.admiralTasks.at(-1)!;
}
function request(e: SimulationEngine, conditions: TaskCondition[] = []) {
  expect(
    choose(e, mira, {
      coordination: {
        type: 'requestTask',
        kind: 'escort',
        agentId: talia,
        action: { type: 'ESCORT', targetId: 'meridian' },
        followUp: {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 20,
          route: 'safe',
          repeat: false,
        },
        conditions,
      },
    }).ok,
  ).toBe(true);
  return e.state.escortRequests.at(-1)!;
}
function answer(
  e: SimulationEngine,
  id: string,
  r: ReturnType<typeof request>,
  response: 'accept' | 'reject' | 'counter' | 'withdraw',
  conditions: TaskCondition[] = [],
) {
  return choose(e, id, {
    coordination: {
      type: 'answerRequest',
      requestId: r.id,
      version: r.conditionVersion,
      response,
      conditions,
      reason: response === 'reject' ? 'risk' : 'damage',
    },
  });
}
function dockCrew(e: SimulationEngine) {
  for (const id of ['meridian', 'horizon']) {
    const ship = e.state.ships.find((s) => s.id === id)!;
    ship.x = e.base.x;
    ship.y = e.base.y;
  }
}

describe('v13 engine reports, decisions and personality', () => {
  it('model-wait evidence survives a paused restart and a superseded proposal cannot execute', () => {
    const e = quietEngine();
    const first = propose(e),
      second = propose(e, '巡逻基地 3 分钟');
    const a = e.state.agents.find((a) => a.id === talia)!;
    expect(first.status).toBe('cancelled');
    expect(e.getObservation(talia)!.taskProposals.map((t) => t.id)).toEqual([second.id]);
    e.dispatchCommand(
      {
        type: 'agentDecisionState',
        agentId: talia,
        revision: a.decision.revision,
        state: 'waiting',
        error: null,
      },
      talia,
    );
    const restored = new SimulationEngine(parseSave(e.state));
    expect(restored.state.paused).toBe(true);
    expect(
      restored.state.agents
        .find((a) => a.id === talia)!
        .decision.events.some((event) => event.kind === 'request'),
    ).toBe(true);
    expect(
      choose(e, talia, {
        coordination: {
          type: 'answerTask',
          taskId: second.id,
          version: 1,
          response: 'reject',
          conditions: [],
          reason: 'conflict',
        },
      }).ok,
    ).toBe(true);
    expect(e.getObservation(talia)!.admiralTask).toBeNull();
    expect(a.decision.pendingReasons).toEqual([]);
    expect(
      choose(e, talia, {
        coordination: {
          type: 'answerTask',
          taskId: first.id,
          version: 1,
          response: 'accept',
          conditions: [],
          reason: 'preference',
        },
      }).ok,
    ).toBe(false);
    run(e, 5);
    expect(first.status).toBe('cancelled');
    expect(second.consent).toBe('rejected');
    expect(a.decision.pendingReasons).toEqual([]);
  });
  it('reports containing @ never wake or write observer memories, and event IDs deduplicate', () => {
    const e = quietEngine();
    choose(e, mira);
    choose(e, talia);
    const before = structuredClone(e.state.agents);
    appendChat(e, mira, COMMAND_CHANNEL, '@Talia 运输已到港，XP +4', [], 'report', {
      eventId: 'directive-1:0:arrived',
    });
    appendChat(e, mira, COMMAND_CHANNEL, 'duplicate', [], 'report', {
      eventId: 'directive-1:0:arrived',
    });
    expect(e.state.chatMessages).toHaveLength(1);
    expect(e.state.chatMessages[0]).toMatchObject({
      sender: 'system',
      channelId: REPORT_CHANNEL,
      mentions: [],
      origin: 'engine',
    });
    expect(e.state.agents).toEqual(before);
    expect(e.getObservation(talia)!.recentChat).toEqual([]);
    expect(
      e.dispatchCommand({
        type: 'sendChat',
        channelId: REPORT_CHANNEL,
        content: '伪造报告',
        mentions: [],
      }).ok,
    ).toBe(false);
    expect(
      choose(e, mira, {
        messages: [{ channelId: REPORT_CHANNEL, content: '伪造报告', mentions: [] }],
      }).ok,
    ).toBe(false);
  });
  it('ordinary Agent @ and acknowledgements cannot start reply loops', () => {
    const e = quietEngine();
    choose(e, mira);
    choose(e, talia);
    const revision = e.state.agents.find((a) => a.id === talia)!.decision.revision;
    expect(
      choose(e, mira, {
        messages: [
          {
            channelId: COMMAND_CHANNEL,
            content: '@Talia 我在考虑风险。',
            mentions: [talia],
            purpose: 'acknowledgement',
          },
        ],
      }).ok,
    ).toBe(true);
    expect(e.state.agents.find((a) => a.id === talia)!.decision).toMatchObject({
      revision,
      pendingReasons: [],
      events: [],
    });
  });
  it.each([1, 4, 16] as const)(
    'unchanged idle simulation at %sx has no periodic decisions',
    (speed) => {
      const e = quietEngine();
      e.state.locations.find((l) => l.id === 'mine')!.siteId = null;
      choose(e, mira);
      choose(e, talia);
      e.state.speed = speed;
      e.state.paused = false;
      const key = decisionWorldKey(e.state.agents[0], e.state);
      for (let i = 0; i < 1200; i++) e.advanceFrame();
      expect(decisionWorldKey(e.state.agents[0], e.state)).toBe(key);
      for (const a of e.state.agents) expect(a.decision.pendingReasons).toEqual([]);
    },
  );
  it('one revision is consumed once, duplicate actions do not restart, and outcomes cannot duplicate XP after restoring', () => {
    const e = quietEngine(),
      a = e.state.agents.find((a) => a.id === mira)!;
    const revision = a.decision.revision;
    const decision: AgentDecision = {
      goal: '物流',
      rationale: '有真实库存',
      action: {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 10,
        route: 'safe',
        repeat: false,
      },
      messages: [],
      memory: null,
      waitMinutes: 5,
      coordination: null,
    };
    expect(
      e.dispatchCommand({ type: 'agentDecision', agentId: mira, revision, decision }, mira).ok,
    ).toBe(true);
    expect(
      e.dispatchCommand({ type: 'agentDecision', agentId: mira, revision, decision }, mira).ok,
    ).toBe(false);
    const ship = e.state.ships.find((s) => s.id === 'meridian')!,
      directive = ship.current!;
    expect(choose(e, mira, { action: decision.action }).ok).toBe(true);
    expect(ship.current!.id).toBe(directive.id);
    until(e, () => ship.current === null);
    const restored = new SimulationEngine(parseSave(e.state)),
      xp = restored.state.agents.find((a) => a.id === mira)!.experience;
    agentOutcome(
      restored,
      restored.state.ships.find((s) => s.id === ship.id)!,
      directive,
      '交付完成',
    );
    expect(restored.state.agents.find((a) => a.id === mira)!.experience).toBe(xp);
  });
  it('identity/seed profiles survive rename and differ within the same career without consuming world RNG', () => {
    const e = quietEngine(),
      seed = e.state.seed;
    const left = makeAgent('peer-one', '甲', 'logistics', null, null, e.state.initialSeed),
      right = makeAgent('peer-two', '乙', 'logistics', null, null, e.state.initialSeed);
    expect(left.profile).not.toEqual(right.profile);
    expect(decisionContext(left, e.state)).not.toEqual(decisionContext(right, e.state));
    const profile = structuredClone(left.profile);
    left.name = '新名字';
    expect(left.profile).toEqual(profile);
    expect(personalProfile(left.id, e.state.initialSeed)).toEqual(profile);
    expect(e.state.seed).toBe(seed);
    expect(parseSave(e.state).agents.map((a) => a.profile)).toEqual(
      e.state.agents.map((a) => a.profile),
    );
  });
  it('psychology, relationships and experience change later decision evidence, with once-only feedback', () => {
    const e = quietEngine(),
      a = e.state.agents.find((a) => a.id === mira)!;
    const ready = decisionContext(a, e.state)!;
    a.fatigue = 90;
    personalFeedback(a, 'forced-work', {
      stress: 30,
      resentment: 30,
      trust: -12,
      morale: -15,
      activity: 'logistics',
      preference: -20,
    });
    const tired = decisionContext(a, e.state)!;
    expect(tired.willingness).toBeLessThan(ready.willingness);
    expect(tired.riskLimit).toBeLessThan(ready.riskLimit);
    const before = structuredClone(a);
    expect(personalFeedback(a, 'forced-work', { trust: 100 })).toBe(false);
    expect(a).toEqual(before);
  });
  it('social effects require authentic visible messages, change goals/relationships and cannot be replayed', () => {
    const e = quietEngine(),
      m = appendChat(e, talia, COMMAND_CHANNEL, '可以互助，但这次风险需要降低。');
    const social = {
      type: 'support' as const,
      messageId: m.id,
      agentId: talia,
      activity: 'security' as const,
    };
    expect(choose(e, mira, { social }).ok).toBe(true);
    const a = e.state.agents.find((a) => a.id === mira)!;
    expect(a.relationships[talia].trust).toBe(52);
    expect(a.longTermGoal.activity).toBe('security');
    expect(choose(e, mira, { social }).ok).toBe(true);
    expect(a.relationships[talia].trust).toBe(52);
    const report = appendChat(e, talia, COMMAND_CHANNEL, '已完成', [], 'report');
    expect(choose(e, mira, { social: { ...social, messageId: report.id } }).ok).toBe(false);
    const hidden = appendChat(e, 'commander', privateChannel(talia), '仅供 Talia');
    expect(choose(e, mira, { social: { ...social, messageId: hidden.id, agentId: null } }).ok).toBe(
      false,
    );
  });
  it('scarce freight is claimed atomically, including engine-issued collaboration actions', () => {
    const e = quietEngine();
    e.state.locations.find((l) => l.id === 'mine')!.stock.materials = 20;
    const action = {
      type: 'HAUL' as const,
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'materials' as const,
      amount: 20,
      route: 'safe' as const,
      repeat: false,
    };
    expect(choose(e, mira, { action }).ok).toBe(true);
    expect(e.submitAction(talia, action).ok).toBe(false);
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current!.reserved.materials).toBe(20);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});

describe('v13 voluntary tasks and enforceable commitments', () => {
  it('a real failed task refunds its reward instead of restarting or paying twice', () => {
    const e = quietEngine(),
      task = propose(e),
      credits = e.state.resources.credits;
    choose(e, talia, {
      coordination: {
        type: 'answerTask',
        taskId: task.id,
        version: 1,
        response: 'counter',
        conditions: [{ type: 'reward', when: 'after', credits: 35 }],
        reason: 'preference',
      },
    });
    e.dispatchCommand({
      type: 'resolveProposal',
      contractId: task.id,
      version: 2,
      response: 'approve',
    });
    run(e, 1);
    const ship = e.state.ships.find((s) => s.id === 'horizon')!;
    expect(ship.current?.taskId).toBe(task.id);
    e.complete(ship, '巡逻目标永久失效', true);
    expect(task.status).toBe('failed');
    expect(e.state.commitments[0].status).toBe('refunded');
    expect(e.state.resources.credits).toBe(credits);
    run(e, 3);
    expect(ship.current).toBeNull();
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('chat proposes without spending or executing; rational refusal preserves trust', () => {
    const e = quietEngine(),
      task = propose(e),
      a = e.state.agents.find((a) => a.id === talia)!;
    run(e, 5);
    expect(task.consent).toBe('proposed');
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current).toBeNull();
    const trust = a.trust,
      credits = e.state.resources.credits;
    expect(
      choose(e, talia, {
        coordination: {
          type: 'answerTask',
          taskId: task.id,
          version: 1,
          response: 'reject',
          conditions: [],
          reason: 'risk',
        },
      }).ok,
    ).toBe(true);
    expect(a.trust).toBe(trust);
    expect(e.state.resources.credits).toBe(credits);
    expect(task.consent).toBe('rejected');
  });
  it('conditional acceptance repairs using real Materials, rests continuously, escrows budget and pays once', () => {
    const e = quietEngine();
    dockCrew(e);
    const ship = e.state.ships.find((s) => s.id === 'horizon')!;
    ship.hull = capabilities(ship).hull * 0.7;
    const task = propose(e),
      credits = e.state.resources.credits,
      materials = e.base.stock.materials;
    expect(
      choose(e, talia, {
        coordination: {
          type: 'answerTask',
          taskId: task.id,
          version: 1,
          response: 'counter',
          reason: 'damage',
          conditions: [
            { type: 'repair', when: 'before', locationId: 'base', hullPercent: 90 },
            { type: 'rest', when: 'before', locationId: 'base', minutes: 3 },
            { type: 'reward', when: 'after', credits: 75 },
          ],
        },
      }).ok,
    ).toBe(true);
    run(e, 2);
    expect(ship.current).toBeNull();
    expect(e.state.resources.credits).toBe(credits);
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 2,
        response: 'approve',
      }).ok,
    ).toBe(true);
    expect(e.state.resources.credits).toBeGreaterThanOrEqual(credits - 75);
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 2,
        response: 'approve',
      }).ok,
    ).toBe(false);
    until(e, () => ship.current?.action.type === 'REST');
    expect(ship.hull).toBe(capabilities(ship).hull);
    expect(e.base.stock.materials).toBeLessThan(materials);
    const rest = ship.current!;
    run(e, 1);
    expect(rest.work).toBeGreaterThan(0);
    const resumed = new SimulationEngine(parseSave(e.state));
    until(
      e,
      () =>
        task.status === 'completed' && e.state.commitments.every((c) => c.status === 'fulfilled'),
    );
    run(resumed, (e.state.tick - resumed.state.tick) / 10);
    expect(resumed.state).toEqual(e.state);
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(75);
    run(e, 10);
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(75);
    expect(e.state.resources.credits).toBeGreaterThanOrEqual(credits - 75);
  });
  it('insufficient reward budget and stale versions reject atomically; cancel refunds unpaid escrow', () => {
    const e = quietEngine(),
      task = propose(e);
    e.state.resources.credits = 40;
    expect(
      choose(e, talia, {
        coordination: {
          type: 'answerTask',
          taskId: task.id,
          version: 1,
          response: 'counter',
          conditions: [{ type: 'reward', when: 'after', credits: 50 }],
          reason: 'preference',
        },
      }).ok,
    ).toBe(true);
    const before = structuredClone(e.state);
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 1,
        response: 'approve',
      }).ok,
    ).toBe(false);
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 2,
        response: 'approve',
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    e.state.resources.credits = 100;
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 2,
        response: 'approve',
      }).ok,
    ).toBe(true);
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 2,
        response: 'cancel',
      }).ok,
    ).toBe(true);
    expect(e.state.resources.credits).toBe(100);
    expect(e.state.commitments[0].status).toBe('refunded');
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('direct takeover overrides unaccepted conditions and invalidates old model output', () => {
    const e = quietEngine(),
      task = propose(e),
      a = e.state.agents.find((a) => a.id === talia)!;
    choose(e, talia, {
      coordination: {
        type: 'answerTask',
        taskId: task.id,
        version: 1,
        response: 'counter',
        conditions: [{ type: 'reward', when: 'after', credits: 9999 }],
        reason: 'preference',
      },
    });
    const old = a.decision.revision,
      trust = a.trust;
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: task.id,
        version: 2,
        response: 'takeover',
      }).ok,
    ).toBe(true);
    run(e, 1);
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current?.controlMode).toBe('direct');
    expect(a.trust).toBe(trust);
    expect(a.decision.revision).toBeGreaterThan(old);
    expect(e.state.resources.credits).toBeGreaterThan(0);
    expect(a.rewardCredits).toBe(0);
  });
  it('REST interruption resets continuous duration and resumes without premature or duplicate XP', () => {
    const e = quietEngine();
    dockCrew(e);
    expect(choose(e, talia, { action: { type: 'REST', targetId: 'base', duration: 4 } }).ok).toBe(
      true,
    );
    const ship = e.state.ships.find((s) => s.id === 'horizon')!,
      rest = ship.current!,
      a = e.state.agents.find((a) => a.id === talia)!;
    run(e, 2);
    const xp = a.experience;
    issue(e, { type: 'MOVE', point: { x: e.base.x + 15, y: e.base.y } }, ship.id, 'INTERRUPT');
    expect(rest.work).toBe(0);
    expect(a.experience).toBe(xp);
    until(e, () => ship.current?.id === rest.id);
    run(e, 2);
    expect(ship.current?.id).toBe(rest.id);
    const resumedXp = a.experience;
    expect(resumedXp).toBe(xp + 3); // The completed direct MOVE has its own real outcome.
    until(e, () => ship.current === null);
    expect(a.experience).toBe(resumedXp + 3);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});

describe('v13 collaboration, negotiation and real consequences', () => {
  it('a team promise waits for both real actions and preserves Admiral queues when cancelled', () => {
    const e = quietEngine();
    dockCrew(e);
    choose(e, mira, {
      coordination: {
        type: 'requestTask',
        kind: 'team',
        agentId: talia,
        action: { type: 'REST', targetId: 'base', duration: 1 },
        followUp: { type: 'REST', targetId: 'base', duration: 5 },
        conditions: [{ type: 'reward', when: 'after', credits: 10 }],
      },
    });
    const r = e.state.escortRequests[0];
    answer(e, talia, r, 'accept');
    e.dispatchCommand({
      type: 'resolveProposal',
      contractId: r.id,
      version: 1,
      response: 'approve',
    });
    run(e, 3);
    expect(r.status).toBe('accepted');
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(0);
    until(e, () => r.status === 'completed');
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(10);
    const other = quietEngine(),
      requesting = request(other);
    answer(other, talia, requesting, 'accept');
    run(other, 1);
    issue(other, { type: 'MOVE', point: { x: 80, y: 0 } }, 'horizon', 'INTERRUPT');
    issue(other, { type: 'RETURN' }, 'horizon', 'QUEUE');
    const before = other.state.ships.find((s) => s.id === 'horizon')!;
    other.dispatchCommand({
      type: 'resolveProposal',
      contractId: requesting.id,
      version: 1,
      response: 'cancel',
    });
    expect(before.current?.action.type).toBe('MOVE');
    expect(before.queue[0].action.type).toBe('RETURN');
    expect(before.suspended).toEqual([]);
    expect(() => parseSave(other.state)).not.toThrow();
  });
  it('declined identical proposals cannot create repeated decision/refusal loops without new evidence', () => {
    const e = quietEngine(),
      r = request(e);
    answer(e, talia, r, 'reject');
    const before = structuredClone(e.state);
    expect(
      choose(e, mira, {
        coordination: {
          type: 'requestTask',
          kind: 'escort',
          agentId: talia,
          action: { type: 'ESCORT', targetId: 'meridian' },
          followUp: {
            type: 'HAUL',
            sourceId: 'mine',
            targetId: 'base',
            cargoKind: 'materials',
            amount: 20,
            route: 'safe',
            repeat: false,
          },
          conditions: [],
        },
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    e.dispatchCommand({
      type: 'sendChat',
      channelId: privateChannel(mira),
      content: '请重新考虑这一轮的协作。',
      mentions: [],
    });
    e.dispatchCommand({
      type: 'admiralChatTask',
      agentId: mira,
      messageId: e.state.chatMessages.at(-1)!.id,
    });
    expect(
      choose(e, mira, {
        coordination: {
          type: 'requestTask',
          kind: 'escort',
          agentId: talia,
          action: { type: 'ESCORT', targetId: 'meridian' },
          followUp: {
            type: 'HAUL',
            sourceId: 'mine',
            targetId: 'base',
            cargoKind: 'materials',
            amount: 20,
            route: 'safe',
            repeat: false,
          },
          conditions: [],
        },
      }).ok,
    ).toBe(true);
  });
  it('legacy escort replies respect explicit deadlines and cannot bypass negotiated conditions', () => {
    const e = quietEngine();
    choose(e, mira, {
      coordination: { type: 'requestEscort', agentId: talia, targetShipId: 'meridian' },
    });
    const r = e.state.escortRequests[0];
    run(e, 20);
    expect(
      choose(e, talia, {
        action: { type: 'ESCORT', targetId: 'meridian' },
        coordination: { type: 'answerEscort', requestId: r.id, accept: true },
      }).ok,
    ).toBe(true);
    const other = quietEngine(),
      conditioned = request(other, [{ type: 'reward', when: 'after', credits: 25 }]);
    expect(
      choose(other, talia, {
        action: { type: 'ESCORT', targetId: 'meridian' },
        coordination: { type: 'answerEscort', requestId: conditioned.id, accept: true },
      }).ok,
    ).toBe(false);
    expect(conditioned.status).toBe('pending');
    expect(other.state.commitments).toEqual([]);
  });
  it.each(['team', 'reinforce'] as const)(
    '%s performs actual patrol support and settles mutual help once',
    (kind) => {
      const e = quietEngine();
      choose(e, mira, {
        coordination: {
          type: 'requestTask',
          kind,
          agentId: talia,
          action: { type: 'PATROL', targetId: 'base', duration: 1 },
          followUp: null,
          conditions: [],
        },
      });
      const r = e.state.escortRequests[0];
      expect(answer(e, talia, r, 'accept').ok).toBe(true);
      until(e, () => r.status === 'completed');
      expect(e.state.agents.find((a) => a.id === talia)!.experience).toBe(10);
      expect(e.state.agents.find((a) => a.id === mira)!.relationships[talia].trust).toBe(56);
      run(e, 2);
      expect(e.state.agents.find((a) => a.id === talia)!.experience).toBe(10);
    },
  );
  it('Agent withdrawal cannot cancel direct Admiral control', () => {
    const e = quietEngine(),
      task = propose(e);
    e.dispatchCommand({
      type: 'resolveProposal',
      contractId: task.id,
      version: 1,
      response: 'takeover',
    });
    const before = structuredClone(e.state);
    expect(
      choose(e, talia, {
        coordination: {
          type: 'answerTask',
          taskId: task.id,
          version: 1,
          response: 'withdraw',
          conditions: [],
          reason: 'conflict',
        },
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
  });
  it('withdrawing an unaccepted proposal preserves relationships, unlike breaking accepted support', () => {
    const e = quietEngine(),
      r = request(e);
    expect(answer(e, mira, r, 'withdraw').ok).toBe(true);
    expect(r.status).toBe('cancelled');
    expect(e.state.agents.find((a) => a.id === mira)!.relationships[talia].trust).toBe(50);
  });
  it('a handoff whose original job loads cargo while the model waits is rejected without moving goods', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'meridian')!,
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    ship.x = mine.x;
    ship.y = mine.y;
    const action = {
      type: 'HAUL' as const,
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'materials' as const,
      amount: 10,
      route: 'safe' as const,
      repeat: false,
    };
    choose(e, mira, { action });
    choose(e, mira, {
      coordination: {
        type: 'requestTask',
        kind: 'handoff',
        agentId: talia,
        action,
        followUp: null,
        conditions: [],
      },
    });
    const r = e.state.escortRequests[0];
    until(e, () => ship.cargo.materials === 10);
    const before = structuredClone(e.state);
    expect(answer(e, talia, r, 'accept').ok).toBe(false);
    expect(e.state).toEqual(before);
    expect(ship.cargo.materials).toBe(10);
  });
  it('same-career profile evidence leads a protocol model to different real actions', async () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'assignAgent', agentId: talia, shipId: null });
    const peer = makeAgent('profile-peer', 'Rin', 'logistics');
    registerAgent(e.state, peer);
    e.dispatchCommand({ type: 'assignAgent', agentId: peer.id, shipId: 'horizon' });
    const safety = peer.profile.motivations.safety;
    expect(safety).toBeLessThan(90);
    const threshold = (safety + 90) / 2;
    const client = new ChatCompletionsClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const obs = JSON.parse(body.messages[1].content);
      const cautious = obs.self.profile.motivations.safety > threshold;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goal: cautious ? '先休息' : '承担运输机会',
                  rationale: '结合稳定安全动机选择',
                  action: cautious
                    ? { type: 'REST', targetId: 'base', duration: 2 }
                    : {
                        type: 'HAUL',
                        sourceId: 'mine',
                        targetId: 'base',
                        cargoKind: 'materials',
                        amount: 10,
                        route: 'safe',
                        repeat: false,
                      },
                }),
              },
            },
          ],
        }),
      );
    });
    const config = {
      baseUrl: 'http://127.0.0.1/v1',
      defaultModel: 'personality-fixture',
      reasoningEffort: 'none' as const,
      apiKey: 'profile-fixture-key',
    };
    for (const id of [mira, peer.id]) {
      const d = await client.decide(config, e.getObservation(id)!);
      expect(choose(e, id, d).ok).toBe(true);
    }
    expect(e.state.ships.find((s) => s.id === 'meridian')!.current?.action.type).toBe('REST');
    expect(e.state.ships.find((s) => s.id === 'horizon')!.current?.action.type).toBe('HAUL');
  });
  it('model waiting never expires a request, but an explicit game deadline does', () => {
    const e = quietEngine(),
      r = request(e);
    run(e, 100);
    expect(r.status).toBe('pending');
    r.explicitDeadline = true;
    r.deadline = e.state.time + 1;
    run(e, 2);
    expect(r.status).toBe('failed');
    expect(e.state.chatMessages.some((m) => m.kind === 'danger' && m.requestId === r.id)).toBe(
      true,
    );
  });
  it('each version is processed once; two counteroffers close further negotiation and notify Admiral', () => {
    const e = quietEngine(),
      r = request(e);
    expect(
      answer(e, talia, r, 'counter', [
        { type: 'rest', when: 'before', locationId: 'base', minutes: 1 },
      ]).ok,
    ).toBe(true);
    expect(answer(e, mira, r, 'counter', []).ok).toBe(true);
    expect(r.rounds).toBe(2);
    expect(r.conditionVersion).toBe(3);
    expect(answer(e, talia, r, 'counter', []).ok).toBe(true);
    expect(r.status).toBe('rejected');
    expect(
      e.state.chatMessages.some((m) => m.kind === 'danger' && m.content.includes('两次反提议')),
    ).toBe(true);
    expect(answer(e, mira, r, 'accept').ok).toBe(false);
  });
  it('accepted escort physically rendezvous before departure; full real haul changes relationships and later preferences', () => {
    const e = quietEngine(),
      source = e.state.locations.find((l) => l.id === 'mine')!,
      freighter = e.state.ships.find((s) => s.id === 'meridian')!,
      escort = e.state.ships.find((s) => s.id === 'horizon')!;
    freighter.x = source.x;
    freighter.y = source.y;
    escort.x = e.base.x;
    escort.y = e.base.y;
    const r = request(e),
      stock = source.stock.materials,
      extracted = source.extracted,
      base = e.base.stock.materials;
    expect(answer(e, talia, r, 'accept').ok).toBe(true);
    run(e, 1);
    expect(escort.current?.action.type).toBe('ESCORT');
    expect(freighter.current).toBeNull();
    until(e, () => freighter.current?.action.type === 'HAUL');
    expect(Math.hypot(escort.x - freighter.x, escort.y - freighter.y)).toBeLessThan(60);
    const saved = new SimulationEngine(parseSave(e.state));
    until(e, () => r.status === 'completed');
    run(saved, (e.state.tick - saved.state.tick) / 10);
    expect(saved.state).toEqual(e.state);
    expect(source.stock.materials).toBeCloseTo(stock + source.extracted - extracted - 20);
    expect(e.base.stock.materials).toBe(base + 20);
    expect(e.state.agents.find((a) => a.id === mira)!.relationships[talia].trust).toBe(56);
    expect(e.getObservation(mira)!.decisionContext!.preferredPeers[0]).toBe(talia);
    expect(
      e.state.agents.find((a) => a.id === talia)!.taskPreferences[
        e.state.agents.find((a) => a.id === talia)!.longTermGoal.activity
      ],
    ).toBeGreaterThan(0);
  });
  it('repair/reward counteroffer waits for requester and Admiral, then fulfils real escort and reward', () => {
    const e = quietEngine(),
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    const escort = e.state.ships.find((s) => s.id === 'horizon')!,
      own = e.state.ships.find((s) => s.id === 'meridian')!;
    for (const ship of [escort, own]) {
      ship.x = mine.x;
      ship.y = mine.y;
    }
    escort.hull = capabilities(escort).hull * 0.8;
    const r = request(e),
      materials = mine.stock.materials,
      extracted = mine.extracted,
      hull = escort.hull,
      credits = e.state.resources.credits;
    answer(e, talia, r, 'counter', [
      { type: 'repair', when: 'before', locationId: mine.id, hullPercent: 90 },
      { type: 'reward', when: 'after', credits: 30 },
    ]);
    expect(answer(e, mira, r, 'accept').ok).toBe(true);
    run(e, 2);
    expect(r.status).toBe('awaitingApproval');
    expect(escort.current).toBeNull();
    expect(
      e.dispatchCommand({
        type: 'resolveProposal',
        contractId: r.id,
        version: r.conditionVersion,
        response: 'approve',
      }).ok,
    ).toBe(true);
    until(e, () => r.status === 'completed');
    expect(mine.stock.materials).toBeCloseTo(
      materials + mine.extracted - extracted - 20 - (escort.hull - hull) / 8,
    );
    expect(escort.hull).toBeGreaterThanOrEqual(capabilities(escort).hull * 0.9);
    expect(e.state.resources.credits).toBeGreaterThanOrEqual(credits - 30);
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(30);
    expect(e.state.commitments.every((c) => c.status === 'fulfilled')).toBe(true);
  });
  it('withdrawal after acceptance works for either participant, refunds escrow and has breach consequences', () => {
    const e = quietEngine(),
      r = request(e, [{ type: 'reward', when: 'after', credits: 35 }]);
    answer(e, talia, r, 'accept');
    const credits = e.state.resources.credits;
    e.dispatchCommand({
      type: 'resolveProposal',
      contractId: r.id,
      version: 1,
      response: 'approve',
    });
    expect(answer(e, mira, r, 'withdraw').ok).toBe(true);
    expect(e.state.resources.credits).toBe(credits);
    expect(r.status).toBe('cancelled');
    expect(e.state.agents.find((a) => a.id === mira)!.relationships[talia].trust).toBe(47);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('vessel loss refunds active commitments and does not fabricate delivery', () => {
    const e = quietEngine(),
      r = request(e, [{ type: 'reward', when: 'after', credits: 25 }]);
    answer(e, talia, r, 'accept');
    const credits = e.state.resources.credits;
    e.dispatchCommand({
      type: 'resolveProposal',
      contractId: r.id,
      version: 1,
      response: 'approve',
    });
    const ship = e.state.ships.find((s) => s.id === 'horizon')!;
    ship.shield = 0;
    e.hit(ship, 10000);
    expect(e.state.resources.credits).toBe(credits);
    expect(r.status).toBe('cancelled');
    expect(e.state.agents.find((a) => a.id === talia)!.rewardCredits).toBe(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it.each(['logistics', 'handoff'] as const)(
    '%s executes from real stock while loaded cargo stays on the original vessel',
    (kind) => {
      const e = quietEngine(),
        own = e.state.ships.find((s) => s.id === 'meridian')!,
        peer = e.state.ships.find((s) => s.id === 'horizon')!;
      own.cargo.materials = 7;
      own.cargo.photon = 2;
      const source = e.state.locations.find((l) => l.id === 'mine')!,
        start = source.stock.materials,
        extracted = source.extracted;
      if (kind === 'handoff')
        expect(
          choose(e, mira, {
            action: {
              type: 'HAUL',
              sourceId: 'mine',
              targetId: 'base',
              cargoKind: 'materials',
              amount: 10,
              route: 'safe',
              repeat: false,
            },
          }).ok,
        ).toBe(true);
      expect(
        choose(e, mira, {
          coordination: {
            type: 'requestTask',
            kind,
            agentId: talia,
            action: {
              type: 'HAUL',
              sourceId: 'mine',
              targetId: 'base',
              cargoKind: 'materials',
              amount: 10,
              route: 'safe',
              repeat: false,
            },
            followUp: null,
            conditions: [],
          },
        }).ok,
      ).toBe(true);
      const r = e.state.escortRequests.at(-1)!;
      expect(answer(e, talia, r, 'accept').ok).toBe(true);
      until(e, () => r.status === 'completed');
      expect(own.cargo).toMatchObject({ materials: 7, photon: 2 });
      expect(peer.cargo.materials).toBe(0);
      expect(source.stock.materials).toBeCloseTo(start + source.extracted - extracted - 10);
      expect(() => parseSave(e.state)).not.toThrow();
    },
  );
});
