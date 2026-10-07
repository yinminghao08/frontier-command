import type { SimulationEngine } from './engine';
import type {
  Agent,
  AgentCareer,
  Command,
  CommandResult,
  Directive,
  Ship,
  WorldState,
} from './types';
import { validateAction, ok, no } from './command-system';
import { capabilities } from './capabilities';
import { hasAdmiralWork } from './fleet';
import { dist } from './navigation';
import { AGENT_RULES } from './definitions/agents';
import {
  addAgentChannels,
  appendChat,
  chatReason,
  COMMAND_CHANNEL,
  privateChannel,
  remember,
  wakeAgent,
} from './chat';

export function makeAgent(
  id: string,
  name: string,
  career: AgentCareer,
  shipId: string | null = null,
  originPersonnelId: string | null = null,
): Agent {
  return {
    id,
    name,
    career,
    personality:
      career === 'battle'
        ? { riskTolerance: 60, cooperation: 78, discipline: 82, ambition: 65 }
        : { riskTolerance: 25, cooperation: 86, discipline: 74, ambition: 58 },
    skills: {
      battle: career === 'battle' ? 55 : 18,
      logistics: career === 'logistics' ? 55 : 22,
      navigation: 40,
    },
    experience: 0,
    trust: 65,
    fatigue: 0,
    morale: 80,
    currentGoal: career === 'battle' ? '保护边疆航线与舰队' : '将矿场库存运往有需求的设施',
    memory: [],
    relationships: {},
    assignedShipId: shipId,
    originPersonnelId,
    modelConfig: { model: null, reasoningEffort: null },
    enabled: true,
    status: shipId ? 'online' : 'unassigned',
    decision: {
      revision: 0,
      pendingReasons: ['assignment'],
      nextAt: 0,
      lastAt: null,
      lastChatId: 0,
      failures: 0,
      lastError: null,
    },
  };
}
export function registerAgent(w: WorldState, agent: Agent) {
  w.agents.push(agent);
  const existing = w.operators.find((o) => o.id === agent.id);
  if (existing) {
    existing.kind = 'agent';
    existing.name = agent.name;
    existing.availability = 'available';
  } else
    w.operators.push({ id: agent.id, name: agent.name, kind: 'agent', availability: 'available' });
  addAgentChannels(w, agent);
  for (const peer of w.agents.filter((a) => a.id !== agent.id)) {
    agent.relationships[peer.id] = { trust: 50, cooperation: 50, lastInteraction: w.time };
    peer.relationships[agent.id] = { trust: 50, cooperation: 50, lastInteraction: w.time };
  }
}
export function validateAutonomousAction(
  e: SimulationEngine,
  s: Ship,
  action: Directive['action'],
) {
  if (hasAdmiralWork(s)) return no('Admiral 当前、队列和挂起指令优先');
  if (
    ['ATTACK', 'DISABLE', 'DRIVE_OFF', 'INTERCEPT'].includes(action.type) &&
    'targetId' in action
  ) {
    const contact = e.state.intel.find((i) => i.id === action.targetId);
    const site = e.state.locations.find(
      (l) => l.id === action.targetId && l.discovered && l.owner !== 'starfleet',
    );
    if (!contact?.hostile && site?.owner !== 'orion') return no('自主交战需要已确认敌对证据');
    if (s.standing.roe === 'HOLD FIRE' && action.type !== 'INTERCEPT')
      return no('ROE 当前要求停止自主开火');
    if (s.standing.roe === 'RETURN FIRE' && action.type !== 'INTERCEPT') {
      const threatened = [
        ...e.state.ships,
        ...e.state.locations.filter((l) => l.owner === 'starfleet'),
      ].some(
        (own) => own.lastAttackerId === action.targetId && e.state.time - own.attackedAt <= 12,
      );
      if (!threatened) return no('RETURN FIRE：需要近期攻击己方的公开证据');
    }
  }
  return validateAction(e, s, action);
}
export function validateAgentCommand(
  e: SimulationEngine,
  c: Command,
  actorId: string,
): CommandResult | null {
  const w = e.state;
  if (c.type === 'sendChat') {
    const reason = chatReason(w, actorId, c.channelId, c.content, c.mentions);
    return reason ? no(reason) : ok();
  }
  if (c.type === 'readChat')
    return w.chatChannels.some((ch) => ch.id === c.channelId && ch.members.includes(actorId)) &&
      c.throughId < w.nextChat
      ? ok()
      : no('会话或消息不可用');
  if (
    ![
      'assignAgent',
      'configureAgent',
      'retryAgent',
      'agentDecision',
      'agentDecisionState',
    ].includes(c.type) ||
    !('agentId' in c)
  )
    return null;
  const a = w.agents.find((a) => a.id === c.agentId);
  if (!a) return no('Agent 不存在');
  if (c.type === 'assignAgent') {
    return c.shipId &&
      (!w.ships.some((s) => s.id === c.shipId) ||
        w.agents.some((other) => other.id !== a.id && other.assignedShipId === c.shipId))
      ? no('舰船不可用或已有 Agent，请先解除分配')
      : ok();
  }
  if (c.type === 'configureAgent' || c.type === 'retryAgent') return ok();
  if (actorId !== a.id || c.revision !== a.decision.revision || !a.enabled)
    return no('决策已过期或 Agent 已离线');
  if (c.type === 'agentDecisionState') return ok();
  const decision = c.decision,
    ship = w.ships.find((s) => s.id === a.assignedShipId);
  if (decision.action) {
    if (!ship) return no('尚未分配舰船');
    const valid = validateAutonomousAction(e, ship, decision.action);
    if (!valid.ok) return valid;
  }
  for (const m of decision.messages) {
    const reason = chatReason(w, a.id, m.channelId, m.content, m.mentions);
    if (reason) return no(reason);
  }
  const coordination = decision.coordination;
  if (coordination?.type === 'requestEscort') {
    const peer = w.agents.find(
      (p) => p.id === coordination.agentId && p.id !== a.id && p.enabled && p.assignedShipId,
    );
    if (!peer || coordination.targetShipId !== a.assignedShipId)
      return no('护航请求必须指定可用同僚和自己的舰船');
    if (
      w.escortRequests.some(
        (r) =>
          r.requesterId === a.id &&
          r.responderId === peer.id &&
          ['pending', 'accepted'].includes(r.status),
      )
    )
      return no('该护航请求仍在处理中');
  }
  if (coordination?.type === 'answerEscort') {
    const request = w.escortRequests.find(
      (r) =>
        r.id === coordination.requestId &&
        r.responderId === a.id &&
        r.status === 'pending' &&
        r.deadline >= w.time,
    );
    if (!request) return no('护航请求已过期或无权限');
    if (
      coordination.accept &&
      (decision.action?.type !== 'ESCORT' || decision.action.targetId !== request.targetShipId)
    )
      return no('接受护航必须提交对应真实 ESCORT');
  }
  return ok();
}
function relationship(w: WorldState, leftId: string, rightId: string, change: number) {
  for (const [id, peer] of [
    [leftId, rightId],
    [rightId, leftId],
  ]) {
    const a = w.agents.find((a) => a.id === id);
    if (!a) continue;
    const r = a.relationships[peer] ?? { trust: 50, cooperation: 50, lastInteraction: w.time };
    r.trust = Math.max(0, Math.min(100, r.trust + change));
    r.cooperation = Math.max(0, Math.min(100, r.cooperation + change));
    r.lastInteraction = w.time;
    a.relationships[peer] = r;
  }
}
export function applyAgentCommand(
  e: SimulationEngine,
  c: Command,
  actorId: string,
): CommandResult | null {
  const w = e.state;
  if (c.type === 'sendChat') {
    appendChat(e, actorId, c.channelId, c.content, c.mentions);
    return ok('消息已发送');
  }
  if (c.type === 'readChat') {
    const ch = w.chatChannels.find((ch) => ch.id === c.channelId)!;
    ch.readThrough = Math.max(ch.readThrough, c.throughId);
    return ok('会话已读');
  }
  if (
    ![
      'assignAgent',
      'configureAgent',
      'retryAgent',
      'agentDecision',
      'agentDecisionState',
    ].includes(c.type) ||
    !('agentId' in c)
  )
    return null;
  const a = w.agents.find((a) => a.id === c.agentId)!;
  if (c.type === 'assignAgent') {
    const old = w.ships.find((s) => s.id === a.assignedShipId);
    if (old?.current?.source === 'agent' && old.current.actorId === a.id)
      e.complete(old, 'Admiral 重新分配舰船', true);
    w.assignments = w.assignments.filter(
      (assignment) => assignment.operatorId !== a.id && assignment.shipId !== c.shipId,
    );
    a.assignedShipId = c.shipId;
    w.operators.find((o) => o.id === a.id)!.availability = 'available';
    if (c.shipId) w.assignments.push({ operatorId: a.id, shipId: c.shipId, since: w.tick });
    wakeAgent(a, 'assignment', w.time, true);
    appendChat(
      e,
      a.id,
      privateChannel(a.id),
      c.shipId
        ? '已接管 ' + w.ships.find((s) => s.id === c.shipId)!.name + '，等待决策。'
        : '舰船分配已解除。',
    );
    return ok('Agent 分配已更新');
  }
  if (c.type === 'configureAgent') {
    a.modelConfig = structuredClone(c.modelConfig);
    a.enabled = c.enabled;
    if (!a.enabled) {
      const ship = w.ships.find((s) => s.id === a.assignedShipId);
      if (ship?.current?.source === 'agent') e.complete(ship, 'Admiral 关闭自主控制', true);
    }
    wakeAgent(a, 'configuration', w.time, true);
    if (!a.enabled) a.status = 'offline';
    return ok('模型与自主控制配置已保存');
  }
  if (c.type === 'retryAgent') {
    wakeAgent(a, 'manual', w.time, true);
    a.decision.lastError = null;
    return ok('已请求再次决策');
  }
  if (c.type === 'agentDecisionState') {
    if (c.state === 'waiting') {
      a.status = 'waiting';
      a.decision.pendingReasons = [];
      a.decision.lastAt = w.time;
    } else if (c.state === 'ready') a.status = a.assignedShipId ? 'online' : 'unassigned';
    else {
      a.status = c.state;
      a.decision.failures++;
      a.decision.lastError = c.error;
      a.decision.nextAt = w.time + AGENT_RULES.errorRetryMinutes;
      a.decision.pendingReasons = ['retry'];
      remember(w, a, 'decision', c.error ?? '通讯不可用');
      appendChat(e, a.id, privateChannel(a.id), c.error ?? '通讯不可用，请稍后重试。', [], 'error');
    }
    return ok();
  }
  const d = c.decision;
  if (d.action) {
    const result = e.submitAction(a.id, d.action);
    if (!result.ok) return result;
  }
  a.currentGoal = d.goal;
  a.status = d.action ? 'executing' : a.assignedShipId ? 'online' : 'unassigned';
  a.decision.lastError = null;
  a.decision.failures = 0;
  a.decision.nextAt = w.time + d.waitMinutes;
  a.decision.lastChatId = w.nextChat - 1;
  remember(w, a, 'decision', d.memory ?? d.rationale, null, 5);
  if (
    d.action &&
    w.chatMessages.some(
      (m) =>
        m.sender === w.commander.id &&
        m.id > a.decision.lastChatId - 6 &&
        (m.channelId === privateChannel(a.id) || m.mentions.includes(a.id)),
    )
  )
    a.trust = Math.min(100, a.trust + 1);
  for (const m of d.messages) appendChat(e, a.id, m.channelId, m.content, m.mentions);
  const coordination = d.coordination;
  if (coordination?.type === 'requestEscort') {
    const peer = w.agents.find((p) => p.id === coordination.agentId)!;
    const request = {
      id: 'escort-' + w.nextId++,
      requesterId: a.id,
      responderId: peer.id,
      targetShipId: coordination.targetShipId,
      created: w.time,
      deadline: w.time + AGENT_RULES.escortDeadline,
      started: false,
      status: 'pending' as const,
    };
    w.escortRequests.push(request);
    appendChat(
      e,
      a.id,
      COMMAND_CHANNEL,
      '@' +
        peer.name +
        ' 请求护航 ' +
        w.ships.find((s) => s.id === coordination.targetShipId)!.name +
        '。' +
        d.rationale,
      [peer.id],
      'request',
    );
    a.currentGoal = (d.goal + '（等待护航答复）').slice(0, 240);
  } else if (coordination?.type === 'answerEscort') {
    const request = w.escortRequests.find((r) => r.id === coordination.requestId)!;
    request.status = coordination.accept ? 'accepted' : 'rejected';
    relationship(w, a.id, request.requesterId, coordination.accept ? 4 : -2);
    const requester = w.agents.find((p) => p.id === request.requesterId)!;
    appendChat(
      e,
      a.id,
      COMMAND_CHANNEL,
      '@' +
        requester.name +
        (coordination.accept ? ' 已接受护航，正在执行 ESCORT。' : ' 暂时拒绝护航。') +
        d.rationale,
      [requester.id],
      'reply',
    );
  }
  if (d.action)
    appendChat(
      e,
      a.id,
      COMMAND_CHANNEL,
      '执行 ' + d.action.type + '：' + d.goal + '。' + d.rationale,
      [],
      'report',
    );
  return ok('Agent 决策已校验并执行');
}
export function agentOutcome(
  e: SimulationEngine,
  ship: Ship,
  directive: Directive,
  text: string,
  failed = false,
  cycle = false,
) {
  if (directive.source !== 'agent') return;
  const w = e.state,
    a = w.agents.find((a) => a.id === directive.actorId);
  if (!a) return;
  const action = directive.action;
  if (!failed) {
    const xp =
      action.type === 'HAUL'
        ? Math.max(2, Math.min(25, directive.delivered / 5))
        : ['ESCORT', 'ATTACK', 'DRIVE_OFF', 'DISABLE', 'PATROL'].includes(action.type)
          ? 10
          : 3;
    a.experience += xp;
    const skill =
      action.type === 'HAUL' || action.type === 'UNLOAD'
        ? 'logistics'
        : ['ESCORT', 'ATTACK', 'INTERCEPT', 'DRIVE_OFF', 'PATROL', 'DISABLE'].includes(action.type)
          ? 'battle'
          : 'navigation';
    a.skills[skill] = Math.min(100, a.skills[skill] + xp * 0.08);
    a.morale = Math.min(100, a.morale + 2);
  } else {
    a.morale = Math.max(0, a.morale - 2);
    a.trust = Math.max(0, a.trust - 1);
  }
  remember(w, a, 'outcome', action.type + ': ' + text, ship.id, 8);
  appendChat(
    e,
    a.id,
    COMMAND_CHANNEL,
    ship.name +
      ' / ' +
      action.type +
      (failed ? ' 未完成：' : cycle ? ' 本轮完成：' : ' 完成：') +
      text +
      ' · XP ' +
      Math.floor(a.experience),
    [],
    failed ? 'danger' : 'report',
  );
  for (const r of w.escortRequests.filter(
    (r) => r.responderId === a.id && r.status === 'accepted' && action.type === 'ESCORT',
  )) {
    r.status = failed ? 'failed' : 'completed';
    relationship(w, a.id, r.requesterId, failed ? -3 : 6);
    const peer = w.agents.find((p) => p.id === r.requesterId)!;
    remember(w, peer, 'outcome', a.name + ' ' + (failed ? '护航中断' : '护航完成'), a.id, 8);
    wakeAgent(peer, 'escortResult', w.time);
  }
  if (!cycle) {
    a.decision.revision++;
    a.status = a.enabled ? 'online' : 'offline';
    wakeAgent(a, 'taskResult', w.time + AGENT_RULES.minDecisionMinutes);
    a.decision.nextAt = w.time + AGENT_RULES.minDecisionMinutes;
  }
}
export function agentVesselLost(e: SimulationEngine, ship: Ship) {
  const w = e.state;
  for (const a of w.agents.filter((a) => a.assignedShipId === ship.id)) {
    if (ship.current?.source === 'agent') agentOutcome(e, ship, ship.current, '舰船永久损失', true);
    a.assignedShipId = null;
    a.decision.revision++;
    a.status = 'unassigned';
    a.decision.pendingReasons = [];
    remember(w, a, 'outcome', ship.name + ' 永久损失，等待 Admiral 分配新舰', ship.id, 10);
    appendChat(
      e,
      a.id,
      COMMAND_CHANNEL,
      ship.name + ' 已永久损失。Agent 档案保留，等待新舰分配。',
      [],
      'danger',
    );
  }
  for (const r of w.escortRequests.filter(
    (r) => r.targetShipId === ship.id && ['pending', 'accepted'].includes(r.status),
  ))
    r.status = 'failed';
}
export function advanceAgents(e: SimulationEngine, dt: number) {
  const w = e.state;
  for (const a of w.agents) {
    const ship = w.ships.find((s) => s.id === a.assignedShipId);
    if (a.assignedShipId && !ship) {
      a.assignedShipId = null;
      a.decision.revision++;
      a.status = 'unassigned';
      remember(w, a, 'outcome', '分配舰船永久损失，等待 Admiral 分配新舰', null, 10);
      appendChat(e, a.id, COMMAND_CHANNEL, '分配舰船已永久损失，等待新舰分配。', [], 'danger');
    }
    const active = ship?.current?.source === 'agent';
    a.fatigue = Math.max(0, Math.min(100, a.fatigue + dt * (active ? 0.045 : -0.1)));
    if (w.tick % 10 !== 0 || !a.enabled || a.status === 'waiting') continue;
    if (ship && hasAdmiralWork(ship)) {
      a.status = 'admiral';
      continue;
    }
    if (a.status === 'admiral') {
      a.status = 'online';
      wakeAgent(a, 'admiralReleased', w.time);
    }
    if (
      ship &&
      (ship.hull / capabilities(ship).hull < 0.45 ||
        w.intel.some((i) => i.live && i.hostile && !i.resolved && dist(i, ship) < 240))
    ) {
      const lastDanger = [...a.memory]
        .reverse()
        .find((m) => m.kind === 'danger' && m.entityId === ship.id);
      if (!lastDanger || w.time - lastDanger.time >= 30) {
        remember(w, a, 'danger', '已观测到近距威胁或舰体低于 45%，需要重新判断风险', ship.id, 9);
        appendChat(
          e,
          a.id,
          COMMAND_CHANNEL,
          ship.name + ' 危险报告：近距已知威胁或舰体受损，请求重新决策。',
          [],
          'danger',
        );
        wakeAgent(a, 'danger', w.time);
      }
    }
    if (!active && !a.decision.pendingReasons.length && w.time >= a.decision.nextAt)
      wakeAgent(a, 'opportunityReview', w.time);
  }
  for (const r of w.escortRequests) {
    if (
      r.status === 'accepted' &&
      w.ships.find((s) => s.id === r.targetShipId)?.current?.action.type === 'HAUL'
    )
      r.started = true;
    if (
      (r.status === 'pending' || (r.status === 'accepted' && !r.started)) &&
      w.time > r.deadline
    ) {
      r.status = 'failed';
      const requester = w.agents.find((a) => a.id === r.requesterId)!;
      appendChat(
        e,
        requester.id,
        COMMAND_CHANNEL,
        '护航请求超时，重新评估运输风险。',
        [],
        'report',
      );
      wakeAgent(requester, 'escortTimeout', w.time);
    }
  }
}
