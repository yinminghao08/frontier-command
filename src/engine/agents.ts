import { bindAssignment } from './assignment';
import { replyRecord } from './agent-runtime/replies';
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
import { capabilities, cargoUsed } from './capabilities';
import { hasAdmiralWork } from './fleet';
import { dist } from './navigation';
import { AGENT_RULES } from './definitions/agents';
import { advanceAgentState } from './agent-state';
import { cancelObjectives } from './objectives';
import { personalState, personalFeedback, decisionWorldKey } from './personality';
import {
  liveRequest,
  cancelContracts,
  settleContract,
} from './contracts';
import { available } from './inventory';
import {
  addAgentChannels,
  appendChat,
  chatReason,
  COMMAND_CHANNEL,
  privateChannel,
  remember,
  wakeAgent,
  pendingReply,
  finishReply,
} from './chat';

export function makeAgent(
  id: string,
  name: string,
  career: AgentCareer,
  shipId: string | null = null,
  originPersonnelId: string | null = null,
  initialSeed = 236807,
): Agent {
  return {
    id,
    name,
    career,
    ...personalState(id, career, initialSeed),
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
    get assignedShipId(){return shipId;},
    originPersonnelId,
    modelConfig: { model: null, reasoningEffort: null,thinking:null },
    enabled: true,
    status: shipId ? 'online' : 'unassigned',
    decision: {
      revision: 0,
      pendingReasons: ['assignment'],
      nextAt: 0,
      lastAt: null,
      lastChatId: 0,
      lastAdmiralMessageId: 0,
      failures: 0,
      lastError: null,
      contextKey: '',
      dangerKey: '',
      events: [],
    },
  };
}
export function registerAgent(w: WorldState, agent: Agent) {
  bindAssignment(w,agent);
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
): CommandResult {
  if (hasAdmiralWork(s)) return no('Admiral 当前、队列和挂起指令优先');
  if (action.type === 'ATTACK_SET') {
    for (const targetId of action.targetIds) {
      const v = validateAutonomousAction(e, s, { type: 'ATTACK', targetId });
      if (!v.ok) return v;
    }
    return ok();
  }
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
  if(c.type==='cognitionDecision')return actorId===c.agentId?e.cognition.validate(c.agentId,c.requestId,c.response):no('不能提交其他Agent的认知');
  if (c.type === 'interpretInteraction') return null;
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
      'cancelAgentReply',
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
  if (c.type === 'cancelAgentReply' || (c.type === 'retryAgent' && c.messageId)) {
    const message = w.chatMessages.find((m) => m.id === c.messageId);
    if (
      !message?.responses?.[a.id] ||
      (c.type === 'cancelAgentReply' && message.responses[a.id] !== 'pending')
    )
      return no('此消息没有可处理的请求');
    return ok();
  }
  if (c.type === 'configureAgent' || c.type === 'retryAgent') return ok();
  if (
    actorId !== a.id ||
    c.revision !== a.decision.revision ||
    (!a.enabled && !(c.type === 'agentDecisionState' && c.state === 'offline'))
  )
    return no('决策已过期或 Agent 已离线');
  if (c.type === 'agentDecisionState') return ok();
  return ok();
}

export function applyAgentCommand(
  e: SimulationEngine,
  c: Command,
  actorId: string,
): CommandResult | null {
  const w = e.state;
  if(c.type==='cognitionDecision')return actorId===c.agentId?e.cognition.commit(c.agentId,c.requestId,c.response):no('不能提交其他Agent的认知');
  if (c.type === 'interpretInteraction') return null;
  if (c.type === 'sendChat') {
    appendChat(e, actorId, c.channelId, c.content, c.mentions, 'message', {
      controlMode: c.controlMode,
    });
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
      'cancelAgentReply',
      'agentDecisionState',
    ].includes(c.type) ||
    !('agentId' in c)
  )
    return null;
  const a = w.agents.find((a) => a.id === c.agentId)!;
  if (c.type === 'assignAgent') {
    if(a.assignedShipId===c.shipId)return ok('分配关系保持不变');
    cancelObjectives(e, null, a.id);
    const old = w.ships.find((s) => s.id === a.assignedShipId);
    if (old) cancelContracts(e, old.id, 'Admiral 重新分舰', 'cancel');
    if (old?.current?.source === 'agent' && old.current.actorId === a.id)
      e.complete(old, 'Admiral 重新分配舰船', true);
    w.assignments = w.assignments.filter(
      (assignment) => assignment.operatorId !== a.id && assignment.shipId !== c.shipId,
    );
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
      [],
      'report',
      { eventId: a.id + ':assignment:' + a.decision.revision },
    );
    return ok('Agent 分配已更新');
  }
  if (c.type === 'configureAgent') {
    a.modelConfig = structuredClone(c.modelConfig);
    a.enabled = c.enabled;
    if (!a.enabled) {
      const ship = w.ships.find((s) => s.id === a.assignedShipId);
      if (ship) cancelContracts(e, ship.id, 'Admiral 关闭自主控制', 'cancel');
      if (ship?.current?.source === 'agent') e.complete(ship, 'Admiral 关闭自主控制', true);
    }
    e.cognition.configurationChanged(a.id);
    if (!a.enabled) a.status = 'offline';
    return ok('模型与自主控制配置已保存');
  }
  if (c.type === 'cancelAgentReply') {
    finishReply(e, a.id, c.messageId, 'cancelled', '模型请求已取消，未执行该请求的动作。');
    for (const task of w.objectives.filter(
      (t) => t.messageId === c.messageId && t.agentId === a.id && t.consent === 'proposed',
    ))
      task.status = 'cancelled';
    a.decision.revision++;
    a.decision.pendingReasons = [];
    a.decision.events = [];
    a.status = a.assignedShipId ? 'online' : 'unassigned';
    return ok('请求已取消');
  }
  if (c.type === 'retryAgent') {
    if (c.messageId) {
      const message = w.chatMessages.find((m) => m.id === c.messageId)!;
      message.responses![a.id] = 'pending';
      const record=replyRecord(e,c.messageId,a.id);if(record.primaryMessageId===null){record.phase='pending';record.revision++;}
    }
    wakeAgent(a, 'manual', w.time, true);
    a.decision.lastError = null;
    return ok('已请求再次决策');
  }
  if (c.type === 'agentDecisionState') {
    if (['waiting','receiving','validating'].includes(c.state)) {
      const pending=pendingReply(w,a.id);
      if(pending){const record=replyRecord(e,pending.id,a.id);if(record.primaryMessageId===null){record.phase=c.state==='validating'?'validating':c.state==='receiving'?'receiving':'pending';record.revision++;}}
      a.status = 'waiting';
      if(c.state==='waiting')e.cognition.claim(a.id);
      // New events remain queued while this request owns its original triggers.
      a.decision.lastAt = w.time;
    } else if (c.state === 'ready'){const ship=w.ships.find(s=>s.id===a.assignedShipId);a.status=ship?.current?.source==='admiral'&&ship.current.controlMode==='direct'?'admiral':ship?.current?'executing':ship?'online':'unassigned';if(!pendingReply(w,a.id)){a.decision.pendingReasons=[];a.decision.events=[];a.decision.contextKey=decisionWorldKey(a,w);}}
    else {
      const alreadyOffline = c.state === 'offline' && a.decision.lastError === c.error;
      const wasInFlight=a.status==='waiting';
      a.status = c.state==='error'?'error':'offline';
      a.decision.failures++;
      a.decision.lastError = c.error;
      a.decision.nextAt = w.time;
      if(c.state==='offline'&&a.enabled){a.decision.events=a.decision.events.filter(event=>event.kind==='danger'||event.kind==='request');a.decision.pendingReasons=a.decision.events.map(event=>event.id);}
      else if(c.state==='offline'||!wasInFlight){a.decision.pendingReasons=[];a.decision.events=[];}
      const message = pendingReply(w, a.id);
      if (message) finishReply(e, a.id, message.id, 'failed', c.error ?? '通讯不可用，请重试。');
      if (!alreadyOffline) {
        remember(w, a, 'decision', c.error ?? '通讯不可用');

      }
    }
    return ok();
  }
  return null;
}

export function agentOutcome(
  e: SimulationEngine,
  ship: Ship,
  directive: Directive,
  text: string,
  failed = false,
  cycle = false,
) {
  if (directive.source !== 'agent' && !directive.executorAgentId) return;
  const w = e.state,
    a = w.agents.find((a) => a.id === (directive.executorAgentId ?? directive.actorId));
  if (!a) return;
  const action = directive.action;
  const outcomeId =
    directive.id +
    ':' +
    directive.cycle +
    ':' +
    (cycle ? 'delivery' : failed ? 'failed' : 'completed');
  if (w.settledOutcomes.includes(outcomeId)) return;
  w.settledOutcomes.push(outcomeId);
  if (failed && /接管|取消|新指令/.test(text)) {
    remember(w, a, 'outcome', action.type + ': ' + text, ship.id, 8);
    appendChat(e, a.id, COMMAND_CHANNEL, ship.name + ' / 指令已中断：' + text, [], 'report', {
      eventId: outcomeId,
    });
    return;
  }
  if (!failed) {
    const xp =
      action.type === 'ATTACK_SET' && !cycle
        ? 0
        : action.type === 'HAUL'
          ? Math.min(25, directive.delivered / 5)
          : ['ESCORT', 'ATTACK', 'ATTACK_SET', 'DRIVE_OFF', 'DISABLE', 'PATROL'].includes(
                action.type,
              )
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
    if (xp > 0)
      personalFeedback(
        a,
        outcomeId,
        { stress: -4, confidence: 3, morale: 3 },
        w.time,
        '真实任务完成',
      );
  } else {
    personalFeedback(
      a,
      outcomeId,
      { stress: 8, confidence: -4, morale: -4 },
      w.time,
      '真实任务失败',
    );
  }
  remember(w, a, 'outcome', action.type + ': ' + text, ship.id, 8);
  if (
    !directive.objectiveId
  )
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
      { eventId: outcomeId },
    );
  if (!cycle && a.status !== 'waiting') {
    a.status = a.enabled ? 'online' : 'offline';
  }
}
export function agentVesselLost(e: SimulationEngine, ship: Ship, operatorIds:readonly string[]=e.state.assignments.filter(a=>a.shipId===ship.id).map(a=>a.operatorId)) {
  const w = e.state;
  cancelContracts(e, ship.id, '协作舰船永久损失', 'failure');
  for (const a of w.agents.filter((a) => operatorIds.includes(a.id))) {
    personalFeedback(
      a,
      ship.id + ':vessel-lost',
      { stress: 20, confidence: -10, morale: -10 },
      w.time,
      '舰船永久损失',
    );
    for (const task of w.objectives.filter(
      (t) => t.agentId === a.id && ['active', 'blocked'].includes(t.status),
    )) {
      task.status = 'cancelled';
      appendChat(e, a.id, task.channelId, '舰船已永久损失，本任务终止。', [], 'danger', {
        origin: 'engine',
        replyTo: task.messageId||null,
        eventId: task.id + ':ship-lost',
      });
      settleContract(e, task, false, '执行舰船永久损失');
    }
    if (ship.current?.source === 'agent') agentOutcome(e, ship, ship.current, '舰船永久损失', true);
    w.assignments=w.assignments.filter(link=>link.operatorId!==a.id);
    a.decision.revision++;
    a.status = 'unassigned';
    a.decision.pendingReasons = [];
    a.decision.events = [];
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
}
export function advanceAgents(e: SimulationEngine, dt: number) {
  const w = e.state;
  for (const incident of w.piracyIncidents.filter((i) => i.stage !== 'resolved')) {
    const a = w.agents.find((a) => a.assignedShipId === incident.shipId && a.enabled);
    if (!a || incident.notifiedAgentIds.includes(a.id)) continue;
    incident.notifiedAgentIds.push(a.id);
    remember(
      w,
      a,
      'danger',
      '运输遭遇 Orion 勒索或登舰，可向战术 Agent 请求 reinforce / ESCORT。',
      incident.shipId,
      10,
    );
    appendChat(
      e,
      a.id,
      COMMAND_CHANNEL,
      '已收到舰载遇袭通信：可请求战术 Agent 增援。',
      [],
      'danger',
      { origin: 'engine', eventId: incident.id + ':danger:' + a.id },
    );
    // A support request can preserve Admiral work; autonomous actions still validate authority.
    wakeAgent(a, 'danger:' + incident.id, w.time, true);
  }
  for (const a of w.agents) {
    const ship = w.ships.find((s) => s.id === a.assignedShipId);
    if (a.assignedShipId && !ship) {
      w.assignments=w.assignments.filter(link=>link.operatorId!==a.id);
      a.decision.revision++;
      a.status = 'unassigned';
      remember(w, a, 'outcome', '分配舰船永久损失，等待 Admiral 分配新舰', null, 10);
      appendChat(e, a.id, COMMAND_CHANNEL, '分配舰船已永久损失，等待新舰分配。', [], 'danger');
    }
    const active =
      !(ship?.current?.action.type === 'REST' && ship.status === 'docked') &&
      (ship?.current?.source === 'agent' || ship?.current?.executorAgentId === a.id);
    advanceAgentState(e, a, ship, dt);
    if(!ship)continue;
    if (w.tick % 10 !== 0 || !a.enabled) continue;
    if (ship && hasAdmiralWork(ship)) {
      a.status = 'admiral';
      a.decision.pendingReasons = a.decision.pendingReasons.filter(
        (reason) => reason !== 'admiralDirective',
      );
      a.decision.events = a.decision.events.filter((event) => event.id !== 'admiralDirective');
      continue;
    }
    if (a.status === 'admiral') {
      a.status = 'online';
    }
    if (
      ship &&
      (ship.hull / capabilities(ship).hull < 0.45 ||
        w.intel.some((i) => i.live && i.hostile && !i.resolved && dist(i, ship) < 240))
    ) {
      const dangerKey = JSON.stringify([
        ship.hull / capabilities(ship).hull < 0.45,
        w.intel
          .filter((i) => i.live && i.hostile && !i.resolved && dist(i, ship) < 240)
          .map((i) => i.id)
          .sort(),
      ]);
      if (dangerKey !== a.decision.dangerKey) {
        a.decision.dangerKey = dangerKey;
        remember(w, a, 'danger', '已观测到近距威胁或舰体低于 45%，需要重新判断风险', ship.id, 9);
        appendChat(
          e,
          a.id,
          COMMAND_CHANNEL,
          ship.name + ' 危险报告：近距已知威胁或舰体受损，请求重新决策。',
          [],
          'danger',
        );
        wakeAgent(a, 'danger', w.time, !pendingReply(w, a.id));
      }
    } else a.decision.dangerKey = '';
    const contextKey = decisionWorldKey(a, w);
    if (!a.decision.contextKey) a.decision.contextKey = contextKey;
    if (
      !active &&
      a.status !== 'waiting' &&
      contextKey !== a.decision.contextKey &&
      !a.decision.pendingReasons.length &&
      w.time >= a.decision.nextAt
    ) {
      wakeAgent(a, 'opportunityChanged', w.time, true);
      a.decision.contextKey = contextKey;
    }
  }
  for (const r of w.escortRequests) {
    const protectedShip = w.ships.find((s) => s.id === r.targetShipId);
    const responder = w.ships.find(
      (s) =>
        s.current?.action.type === 'ESCORT' &&
        s.current.action.targetId === r.targetShipId &&
        s.current.actorId === r.responderId,
    );
    if (
      r.kind === 'reinforce' &&
      r.status === 'accepted' &&
      r.rescueArrivedAt === undefined &&
      protectedShip &&
      responder &&
      dist(responder, protectedShip) < 60
    ) {
      r.started = true;
      r.rescueArrivedAt = w.time;
      e.record(
        'rescueArrived',
        responder.name + ' 实际抵达 ' + protectedShip.name + '，执行救援护航',
        protectedShip.id,
      );
    }
    if (
      r.status === 'accepted' &&
      w.ships.find((s) => s.id === r.targetShipId)?.current?.action.type === 'HAUL' &&
      w.ships.find((s) => s.id === r.targetShipId)?.current?.phase === 'delivering' &&
      w.ships.some(
        (s) =>
          s.current?.action.type === 'ESCORT' &&
          s.current.action.targetId === r.targetShipId &&
          s.current.actorId === r.responderId &&
          dist(s, w.ships.find((s) => s.id === r.targetShipId)!) < 60,
      )
    )
      r.started = true;
  }
}
