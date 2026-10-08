import type { SimulationEngine } from './engine';
import type {
  Action,
  AdmiralTask,
  Agent,
  AgentDecision,
  CollaborationRequest,
  Command,
  TaskCondition,
} from './types';
import { appendChat, COMMAND_CHANNEL, remember, wakeAgent } from './chat';
import { capabilities, cargoUsed } from './capabilities';
import { available } from './inventory';
import { dist } from './navigation';
import { validateAction, no, ok } from './command-system';
import { personalFeedback, clampMood, decisionWorldKey } from './personality';

type Contract = AdmiralTask | CollaborationRequest;
export const liveRequest = (r: CollaborationRequest) =>
  ['pending', 'negotiating', 'awaitingApproval', 'accepted'].includes(r.status);
export const findContract = (e: SimulationEngine, id: string): Contract | undefined =>
  e.state.admiralTasks.find((t) => t.id === id) ?? e.state.escortRequests.find((r) => r.id === id);
const isTask = (c: Contract): c is AdmiralTask => 'consent' in c;
const beneficiary = (c: Contract) => (isTask(c) ? c.agentId : c.responderId);
function hasContractWork(e: SimulationEngine, id: string, except?: string) {
  return e.state.ships.some((s) =>
    [s.current, ...s.queue, ...s.suspended].some(
      (d) => d?.id !== except && (d?.contractId === id || d?.taskId === id),
    ),
  );
}
export function stopContractPlans(e: SimulationEngine, id: string) {
  for (const ship of e.state.ships) {
    ship.queue = ship.queue.filter((d) => d.contractId !== id && d.taskId !== id);
    ship.suspended = ship.suspended.filter((d) => d.contractId !== id && d.taskId !== id);
    if (ship.current?.contractId === id || ship.current?.taskId === id)
      e.complete(ship, '协作或任务已取消；实际货物保留', true);
  }
}
export function cancelDescendants(e: SimulationEngine, id: string) {
  for (const child of e.state.escortRequests.filter(
    (r) => r.parentTaskId === id && liveRequest(r),
  )) {
    settleContract(e, child, false, '上级任务已取消', 'cancel');
    child.status = 'cancelled';
    stopContractPlans(e, child.id);
    cancelDescendants(e, child.id);
  }
}
export function requestFingerprint(
  e: SimulationEngine,
  requesterId: string,
  responderId: string,
  kind: CollaborationRequest['kind'],
  action: Action,
  followUp: Action | null,
  conditions: TaskCondition[],
) {
  const requester = e.state.agents.find((a) => a.id === requesterId)!,
    responder = e.state.agents.find((a) => a.id === responderId)!;
  const evidence = JSON.stringify([
    responderId,
    kind,
    action,
    followUp,
    conditions,
    decisionWorldKey(requester, e.state),
    decisionWorldKey(responder, e.state),
    requester.decision.lastAdmiralMessageId,
  ]);
  let left = 2166136261,
    right = 5381;
  for (const char of evidence) {
    left = Math.imul(left ^ char.charCodeAt(0), 16777619) >>> 0;
    right = (Math.imul(right, 33) ^ char.charCodeAt(0)) >>> 0;
  }
  return `proposal:${left}:${right}`;
}
function remainingHandoff(e: SimulationEngine, shipId: string, action: Action) {
  const ship = e.state.ships.find((s) => s.id === shipId);
  return (
    ship &&
    [ship.current, ...ship.queue, ...ship.suspended].find(
      (plan) =>
        plan?.source === 'agent' &&
        !plan.contractId &&
        plan.carried <= plan.delivered &&
        JSON.stringify(plan.action) === JSON.stringify(action),
    )
  );
}
function notice(
  e: SimulationEngine,
  c: Contract,
  text: string,
  kind: 'request' | 'reply' | 'danger' | 'report' = 'request',
) {
  const sender = beneficiary(c);
  return appendChat(e, sender, isTask(c) ? c.channelId : COMMAND_CHANNEL, text, [], kind, {
    origin: 'engine',
    requestId: c.id,
    eventId: `${c.id}:${c.conditionVersion}:${kind}:${text}`.slice(0, 160),
  });
}
export function conditionsReason(
  e: SimulationEngine,
  conditions: TaskCondition[],
  agentId: string,
) {
  if (new Set(conditions.map((c) => c.type)).size !== conditions.length)
    return '同类条件只能提出一次';
  for (const c of conditions) {
    if (
      'locationId' in c &&
      !e.state.locations.some((l) => l.id === c.locationId && l.owner === 'starfleet' && l.hull > 0)
    )
      return '准备条件需要真实己方设施';
    if (
      c.type === 'escort' &&
      (c.agentId === agentId ||
        !e.state.agents.some((a) => a.id === c.agentId && a.enabled && a.assignedShipId))
    )
      return '护航条件需要另一位可用 Agent';
  }
  return null;
}
export function makeRequest(
  e: SimulationEngine,
  requesterId: string,
  responderId: string,
  kind: CollaborationRequest['kind'],
  action: Action,
  followUp: Action | null = null,
  conditions: TaskCondition[] = [],
  parentTaskId: string | null = null,
): CollaborationRequest {
  const a = e.state.agents.find((a) => a.id === requesterId)!;
  const fingerprint = requestFingerprint(
    e,
    requesterId,
    responderId,
    kind,
    action,
    followUp,
    conditions,
  );
  if (!a.feedbackEvents.includes(fingerprint)) a.feedbackEvents.push(fingerprint);
  const r: CollaborationRequest = {
    id: 'escort-' + e.state.nextId++,
    requesterId,
    responderId,
    targetShipId: a.assignedShipId!,
    created: e.state.time,
    deadline: e.state.time,
    explicitDeadline: false,
    started: false,
    executionStarted: false,
    status: 'pending',
    kind,
    action: structuredClone(action),
    followUp: structuredClone(followUp),
    conditions: structuredClone(conditions),
    parentTaskId,
    conditionVersion: 1,
    rounds: 0,
    turnAgentId: responderId,
    creditsApproved: false,
    reason: null,
  };
  e.state.escortRequests.push(r);
  const peer = e.state.agents.find((a) => a.id === responderId)!;
  appendChat(
    e,
    requesterId,
    COMMAND_CHANNEL,
    '@' + peer.name + ` 请求${kind === 'escort' ? '护航' : kind}：${a.currentGoal}`,
    [responderId],
    'request',
    { origin: 'engine', requestId: r.id, eventId: r.id + ':proposed' },
  );
  wakeAgent(peer, 'request:' + r.id + ':1', e.state.time, true);
  return r;
}
export function validateNegotiation(e: SimulationEngine, a: Agent, d: AgentDecision) {
  const c = d.coordination;
  if (c?.type === 'requestTask') {
    const peer = e.state.agents.find(
      (p) => p.id === c.agentId && p.id !== a.id && p.enabled && p.assignedShipId,
    );
    const ship = e.state.ships.find((s) => s.id === peer?.assignedShipId);
    if (!ship || !a.assignedShipId) return no('协作双方必须有真实舰船');
    if (
      a.feedbackEvents.includes(
        requestFingerprint(e, a.id, peer!.id, c.kind, c.action, c.followUp, c.conditions),
      )
    )
      return no('相同条件与公开状态的请求已处理；需要新依据或新的 Admiral 意图');
    if (
      e.state.escortRequests.some(
        (r) => r.requesterId === a.id && r.responderId === peer!.id && liveRequest(r),
      )
    )
      return no('已有进行中的协作请求');
    const valid = validateAction(e, ship, c.action);
    if (!valid.ok) return valid;
    if (
      c.kind === 'escort' &&
      (c.action.type !== 'ESCORT' || c.action.targetId !== a.assignedShipId)
    )
      return no('护航计划必须指向请求者舰船');
    if (c.kind === 'logistics' && c.action.type !== 'HAUL') return no('物流协作需要真实 HAUL');
    if (c.kind === 'escort' && d.action?.type === 'HAUL')
      return no('需护航的运输请放入 followUp，等待同僚接受及实际会合');
    if (c.kind === 'handoff' && (d.action || c.followUp))
      return no('交接只移交剩余任务，不能同时改变原舰行动');
    if (c.kind === 'handoff') {
      const remaining = remainingHandoff(e, a.assignedShipId, c.action);
      if (!remaining) return no('交接需要原舰真实存在且尚未装载的剩余任务意图');
    }
    if (c.followUp) {
      const own = e.state.ships.find((s) => s.id === a.assignedShipId)!;
      const validOwn = validateAction(e, own, c.followUp);
      if (!validOwn.ok) return validOwn;
    }
    const reason = conditionsReason(e, c.conditions, peer!.id);
    return reason ? no(reason) : ok();
  }
  if (c?.type === 'answerRequest' || c?.type === 'answerTask') {
    const contract = findContract(e, c.type === 'answerTask' ? c.taskId : c.requestId);
    if (contract && isTask(contract) && contract.controlMode === 'direct')
      return no('Admiral 直接指挥只能由 Admiral 取消或接管');
    if (
      !contract ||
      isTask(contract) !== (c.type === 'answerTask') ||
      contract.conditionVersion !== c.version ||
      (c.response !== 'withdraw' && contract.turnAgentId !== a.id)
    )
      return no('协商版本已过期或不轮到此 Agent');
    if (
      e.state.settledOutcomes.includes(contract.id + ':settled') ||
      (isTask(contract)
        ? !['active', 'blocked'].includes(contract.status) ||
          !['proposed', 'negotiating', 'accepted'].includes(contract.consent)
        : !liveRequest(contract))
    )
      return no('请求已结束');
    if (
      c.response !== 'withdraw' &&
      (isTask(contract)
        ? contract.consent === 'accepted'
        : !['pending', 'negotiating'].includes(contract.status))
    )
      return no('已接受的版本不能再次协商');
    if (
      c.response === 'withdraw' &&
      (isTask(contract)
        ? contract.agentId !== a.id
        : ![contract.requesterId, contract.responderId].includes(a.id))
    )
      return no('无权撤回');
    if (c.response !== 'counter' && c.conditions.length) return no('只有反提议可以修改条件');
    const reason = conditionsReason(e, c.conditions, a.id);
    if (reason) return no(reason);
    if (d.action) return no('协商响应的行动由已校验计划执行，不能同时提交另一个行动');
    if (isTask(contract) && c.response === 'accept' && contract.action) {
      const ship = e.state.ships.find((s) => s.id === a.assignedShipId);
      if (!ship) return no('任务需要真实舰船');
      const valid = validateAction(e, ship, contract.action);
      if (!valid.ok) return valid;
    }
    if (!isTask(contract) && c.response === 'accept') {
      const responder = e.state.agents.find((a) => a.id === contract.responderId);
      const ship = e.state.ships.find((s) => s.id === responder?.assignedShipId);
      if (!ship || !contract.action) return no('协作计划或舰船不可用');
      if (
        contract.kind === 'handoff' &&
        !remainingHandoff(e, contract.targetShipId, contract.action)
      )
        return no('交接意图已变更或已装货；必须重新评估剩余责任');
      const valid = validateAction(e, ship, contract.action);
      if (!valid.ok) return valid;
    }
  }
  if (d.social) {
    const m = e.state.chatMessages.find((m) => m.id === d.social!.messageId);
    const channel = e.state.chatChannels.find((ch) => ch.id === m?.channelId);
    if (
      !m ||
      m.sender === a.id ||
      m.origin === 'engine' ||
      !channel?.members.includes(a.id) ||
      (m.sender !== e.state.commander.id && m.sender !== d.social.agentId)
    )
      return no('交流影响必须引用真实、可见且由对方发出的消息');
    if (
      d.social.agentId &&
      !e.state.agents.some((p) => p.id === d.social!.agentId && p.id !== a.id)
    )
      return no('同僚不存在');
  }
  return ok();
}
export function acceptContract(e: SimulationEngine, c: Contract) {
  if (isTask(c)) c.consent = 'accepted';
  else
    c.status =
      c.conditions.some((c) => c.type === 'reward') && !c.creditsApproved
        ? 'awaitingApproval'
        : 'accepted';
  notice(
    e,
    c,
    c.conditions.some((c) => c.type === 'reward') && !c.creditsApproved
      ? '已同意条件，等待 Admiral 确认奖励预算。'
      : isTask(c) && !c.conditions.length
        ? '接受指令。'
        : '自愿接受任务，准备条件由引擎执行。',
    'reply',
  );
  if (c.conditions.some((c) => c.type === 'reward') && !c.creditsApproved) return;
  createCommitments(e, c);
}
function createCommitments(e: SimulationEngine, c: Contract) {
  for (const condition of c.conditions) {
    const id = `${c.id}:condition:${c.conditions.indexOf(condition)}`;
    if (!e.state.commitments.some((p) => p.id === id))
      e.state.commitments.push({
        id,
        contractId: c.id,
        agentId: beneficiary(c),
        condition: structuredClone(condition),
        status: 'pending',
        escrow: 0,
        directiveId: null,
      });
  }
}
export function approveContract(e: SimulationEngine, c: Contract) {
  createCommitments(e, c);
  for (const p of e.state.commitments.filter(
    (p) =>
      p.contractId === c.id && p.condition.type === 'reward' && p.status === 'pending' && !p.escrow,
  )) {
    if (p.condition.type === 'reward') {
      e.state.resources.credits -= p.condition.credits;
      p.escrow = p.condition.credits;
    }
  }
  c.creditsApproved = true;
  if (isTask(c)) {
    c.consent = 'accepted';
    c.status = 'active';
  } else c.status = 'accepted';
  notice(e, c, 'Admiral 已确认条件；奖励预算已转入托管，不能用于其他消费。', 'reply');
}
export function relationshipFeedback(
  e: SimulationEngine,
  leftId: string,
  rightId: string,
  eventId: string,
  delta: number,
  summary: string,
) {
  for (const [id, peerId] of [
    [leftId, rightId],
    [rightId, leftId],
  ]) {
    const a = e.state.agents.find((a) => a.id === id);
    if (!a || !personalFeedback(a, eventId, {})) continue;
    const r = a.relationships[peerId];
    if (r) {
      r.trust = clampMood(r.trust + delta);
      r.cooperation = clampMood(r.cooperation + delta);
      r.lastInteraction = e.state.time;
    }
    remember(e.state, a, 'outcome', summary, peerId, 8);
  }
}
export function settleContract(
  e: SimulationEngine,
  c: Contract,
  success: boolean,
  reason: string,
  consequence: 'failure' | 'cancel' = 'failure',
) {
  if (e.state.settledOutcomes.includes(c.id + ':settled')) return;
  e.state.settledOutcomes.push(c.id + ':settled');
  const a = e.state.agents.find((a) => a.id === beneficiary(c));
  if (a && personalFeedback(a, c.id + ':memory', {}))
    remember(e.state, a, 'outcome', (success ? '承诺兑现：' : '承诺中止：') + reason, c.id, 9);
  for (const p of e.state.commitments.filter(
    (p) => p.contractId === c.id && p.status === 'pending',
  )) {
    if (success && p.condition.type === 'reward') {
      if (a) {
        a.rewardCredits += p.escrow;
        personalFeedback(a, p.id, { trust: 4, morale: 4, resentment: -3 });
      }
      p.escrow = 0;
      p.status = 'fulfilled';
    } else {
      e.state.resources.credits += p.escrow;
      p.escrow = 0;
      p.status = p.condition.type === 'reward' ? 'refunded' : 'broken';
    }
  }
  if (a && (success || consequence === 'failure'))
    personalFeedback(a, c.id + ':result', {
      morale: success ? 3 : -2,
      confidence: success ? 3 : -3,
      stress: success ? -5 : 4,
      activity: a.longTermGoal.activity,
      preference: success ? 3 : -2,
    });
  if (!isTask(c)) {
    c.status = success ? 'completed' : 'failed';
    if (success || consequence === 'failure')
      relationshipFeedback(
        e,
        c.requesterId,
        c.responderId,
        c.id + ':relationship',
        success ? 6 : -3,
        reason,
      );
    if (!success)
      for (const id of [c.requesterId, c.responderId]) {
        const agent = e.state.agents.find((a) => a.id === id);
        if (agent) wakeAgent(agent, `request:${c.id}:ended`, e.state.time, true);
      }
  }
  if (!isTask(c) || c.conditions.length)
    notice(e, c, (success ? '承诺兑现：' : '承诺中止：') + reason, success ? 'report' : 'danger');
}
export function cancelContracts(
  e: SimulationEngine,
  shipId: string,
  reason = 'Admiral 接管或任务对象失效',
  consequence: 'failure' | 'cancel' = 'cancel',
) {
  for (const r of e.state.escortRequests.filter(liveRequest)) {
    const peer = e.state.agents.find((a) => a.id === r.responderId);
    if (r.targetShipId !== shipId && peer?.assignedShipId !== shipId) continue;
    if (r.id === e.executingContractId) continue;
    r.status = 'cancelled';
    r.reason = reason;
    settleContract(e, r, false, r.reason, consequence);
    r.status = 'cancelled';
    stopContractPlans(e, r.id);
    cancelDescendants(e, r.id);
  }
}
export function applyNegotiation(e: SimulationEngine, a: Agent, d: AgentDecision) {
  const response = d.coordination;
  if (response?.type === 'requestTask')
    makeRequest(
      e,
      a.id,
      response.agentId,
      response.kind,
      response.action,
      response.followUp,
      response.conditions,
    );
  if (response?.type === 'answerRequest' || response?.type === 'answerTask') {
    const c = findContract(
      e,
      response.type === 'answerTask' ? response.taskId : response.requestId,
    )!;
    if (response.response === 'counter') {
      if (c.rounds >= 2) {
        if (isTask(c)) {
          c.consent = 'rejected';
          c.status = 'cancelled';
        } else c.status = 'rejected';
        notice(e, c, '协商已达到两次反提议上限，需要 Admiral 重新安排。', 'danger');
      } else {
        c.rounds++;
        c.conditionVersion++;
        c.conditions = structuredClone(response.conditions);
        c.creditsApproved = false;
        c.turnAgentId = isTask(c)
          ? e.state.commander.id
          : a.id === c.responderId
            ? c.requesterId
            : c.responderId;
        if (isTask(c)) c.consent = 'negotiating';
        else c.status = 'negotiating';
        notice(e, c, '提出条件：' + d.rationale, 'request');
        const other = e.state.agents.find((a) => a.id === c.turnAgentId);
        if (other) wakeAgent(other, `request:${c.id}:${c.conditionVersion}`, e.state.time, true);
      }
    } else if (response.response === 'accept') acceptContract(e, c);
    else {
      const promised = isTask(c)
        ? c.consent === 'accepted'
        : c.status === 'accepted' || c.executionStarted;
      if (isTask(c)) {
        c.consent = response.response === 'withdraw' ? 'withdrawn' : 'rejected';
        c.status = 'cancelled';
      } else c.status = response.response === 'withdraw' ? 'cancelled' : 'rejected';
      notice(
        e,
        c,
        (response.response === 'withdraw' ? '撤回任务：' : '拒绝任务：') + d.rationale,
        'reply',
      );
      if (response.response === 'withdraw') {
        settleContract(
          e,
          c,
          false,
          promised ? '主动撤回已承诺任务' : '撤回尚未承诺的提议',
          promised ? 'failure' : 'cancel',
        );
        if (isTask(c)) {
          c.status = 'cancelled';
          c.consent = 'withdrawn';
        } else c.status = 'cancelled';
        stopContractPlans(e, c.id);
        cancelDescendants(e, c.id);
      }
      if (!isTask(c)) {
        const other = e.state.agents.find((p) => p.id === c.requesterId)!;
        wakeAgent(other, `request:${c.id}:declined`, e.state.time, true);
      }
    }
  }
  if (d.social) {
    const social = d.social,
      delta = social.type === 'support' || social.type === 'mediate' ? 2 : -2;
    const fresh = personalFeedback(a, `social:${social.messageId}`, {
      morale: delta,
      stress: -delta,
      trust: social.agentId ? 0 : delta,
      resentment: -delta,
      activity: social.activity ?? undefined,
      preference: social.type === 'preference' ? 5 : 0,
    });
    if (fresh && social.agentId)
      relationshipFeedback(
        e,
        a.id,
        social.agentId,
        `social:${social.messageId}:${a.id}`,
        delta,
        '交流改变了合作意愿：' + social.type,
      );
    if (fresh && social.activity) a.longTermGoal = { activity: social.activity, summary: d.goal };
  }
}
function issue(e: SimulationEngine, agentId: string, c: Contract, action: Action) {
  const previous = e.executingContractId;
  e.executingContractId = c.id;
  try {
    return e.submitAction(agentId, action);
  } finally {
    e.executingContractId = previous;
  }
}
/** Conditions have physical proofs; model prose can never fulfil them. */
export function readyConditions(e: SimulationEngine, c: Contract, when: 'before' | 'after') {
  createCommitments(e, c);
  const a = e.state.agents.find((a) => a.id === beneficiary(c));
  const ship = e.state.ships.find((s) => s.id === a?.assignedShipId);
  if (!a || !ship) return false;
  for (const p of e.state.commitments.filter(
    (p) =>
      p.contractId === c.id &&
      p.condition.when === when &&
      p.status === 'pending' &&
      p.condition.type !== 'reward',
  )) {
    const condition = p.condition;
    if (
      condition.type === 'repair' &&
      (ship.hull / capabilities(ship).hull) * 100 >= condition.hullPercent &&
      ship.engines >= 100 &&
      ship.weapons >= 100
    ) {
      p.status = 'fulfilled';
      continue;
    }
    if (condition.type === 'escort') {
      const peer = e.state.agents.find((a) => a.id === condition.agentId);
      const escort = e.state.ships.find((s) => s.id === peer?.assignedShipId);
      if (
        escort?.current?.action.type === 'ESCORT' &&
        escort.current.action.targetId === ship.id &&
        dist(escort, ship) < 60
      ) {
        p.status = 'fulfilled';
        continue;
      }
      if (
        !e.state.escortRequests.some(
          (r) => r.parentTaskId === c.id && r.responderId === condition.agentId && liveRequest(r),
        )
      ) {
        if (
          e.state.escortRequests.some(
            (r) =>
              r.parentTaskId === c.id &&
              r.responderId === condition.agentId &&
              ['rejected', 'failed', 'cancelled'].includes(r.status),
          )
        )
          return false;
        makeRequest(
          e,
          a.id,
          condition.agentId,
          'escort',
          { type: 'ESCORT', targetId: ship.id },
          null,
          [],
          c.id,
        );
      }
      return false;
    }
    if (ship.current) return false;
    if (condition.type === 'repair' || condition.type === 'rest') {
      const result = issue(
        e,
        a.id,
        c,
        condition.type === 'repair'
          ? { type: 'REPAIR', targetId: condition.locationId }
          : { type: 'REST', targetId: condition.locationId, duration: condition.minutes },
      );
      if (result.ok)
        p.directiveId = e.state.ships.find((s) => s.id === ship.id)?.current?.id ?? null;
      else notice(e, c, '准备受阻：' + result.reason);
      return false;
    }
  }
  return true;
}
export function contractDirectiveOutcome(
  e: SimulationEngine,
  directiveId: string,
  contractId: string | null,
  failed: boolean,
) {
  if (!contractId) return;
  const c = findContract(e, contractId);
  if (!c) return;
  const preparation = e.state.commitments.find(
    (p) => p.directiveId === directiveId && p.status === 'pending',
  );
  if (preparation) {
    if (!failed) preparation.status = 'fulfilled';
    else settleContract(e, c, false, '准备行动失败');
    return;
  }
  if (!isTask(c)) {
    const directive = e.state.ships.find((s) => s.current?.id === directiveId)?.current;
    if (directive?.actorId !== c.responderId) {
      if (failed) settleContract(e, c, false, '协作后续行动失败');
      else if (
        c.reason === 'physicalComplete' &&
        !c.followUp &&
        !hasContractWork(e, c.id, directiveId) &&
        readyConditions(e, c, 'after')
      )
        settleContract(e, c, true, '双方协作行动与条件完成');
      return;
    }
    if (failed) settleContract(e, c, false, '协作行动失败');
    else {
      c.reason = 'physicalComplete';
      if (!c.followUp && !hasContractWork(e, c.id, directiveId) && readyConditions(e, c, 'after'))
        settleContract(e, c, true, '真实协作行动完成');
    }
  }
}
export function advanceContracts(e: SimulationEngine) {
  if (e.state.tick % 10 !== 0) return;
  for (const r of e.state.escortRequests) {
    if (['failed', 'cancelled', 'rejected'].includes(r.status)) {
      if (hasContractWork(e, r.id)) stopContractPlans(e, r.id);
      continue;
    }
    if (
      liveRequest(r) &&
      (!e.state.ships.some((s) => s.id === r.targetShipId) ||
        !e.state.ships.some(
          (s) => s.id === e.state.agents.find((a) => a.id === r.responderId)?.assignedShipId,
        ) ||
        (r.explicitDeadline && e.state.time > r.deadline))
    ) {
      settleContract(e, r, false, '对象失效或真实期限已到');
      continue;
    }
    if (r.status !== 'accepted') continue;
    if (r.reason === 'physicalComplete') {
      const own = e.state.ships.find((s) => s.id === r.targetShipId);
      if (r.followUp && own && !own.current) {
        const result = issue(e, r.requesterId, r, r.followUp);
        if (result.ok) r.followUp = null;
      }
      if (!r.followUp && !hasContractWork(e, r.id) && readyConditions(e, r, 'after'))
        settleContract(e, r, true, '真实协作行动完成');
      continue;
    }
    if (!readyConditions(e, r, 'before')) continue;
    const a = e.state.agents.find((a) => a.id === r.responderId)!;
    const ship = e.state.ships.find((s) => s.id === a.assignedShipId);
    if (!ship) {
      settleContract(e, r, false, '协作舰船永久损失');
      continue;
    }
    if (!r.executionStarted) {
      if (ship.current && ship.current.contractId !== r.id) continue;
      if (r.kind === 'handoff') {
        const requesterShip = e.state.ships.find((s) => s.id === r.targetShipId);
        const remaining = r.action ? remainingHandoff(e, r.targetShipId, r.action) : null;
        if (!remaining) {
          settleContract(e, r, false, '准备期间原任务已变更或装货，交接取消', 'cancel');
          r.status = 'cancelled';
          continue;
        }
        if (
          r.action?.type === 'HAUL' &&
          (available(e.state, r.action.sourceId, r.action.cargoKind) +
            remaining.reserved[r.action.cargoKind] <
            r.action.amount ||
            cargoUsed(ship) + r.action.amount > capabilities(ship).cargo)
        ) {
          if (r.reason !== '交接等待真实库存与货舱空间') {
            r.reason = '交接等待真实库存与货舱空间';
            notice(e, r, r.reason);
          }
          continue;
        }
        // Loaded goods stay on their original vessel. Only future, unladen intent moves.
        if (requesterShip?.current?.id === remaining.id) {
          requesterShip.current = null;
          requesterShip.path = [];
          requesterShip.status = 'idle';
        }
        if (requesterShip) {
          requesterShip.queue = requesterShip.queue.filter((d) => d.id !== remaining.id);
          requesterShip.suspended = requesterShip.suspended.filter((d) => d.id !== remaining.id);
        }
      }
      if (r.action) {
        const result = issue(e, a.id, r, r.action);
        if (!result.ok) {
          if (r.reason !== result.reason) {
            r.reason = result.reason;
            notice(e, r, '协作执行受阻：' + result.reason);
          }
          continue;
        }
      }
      r.executionStarted = true;
    }
    if (r.followUp) {
      const requester = e.state.agents.find((a) => a.id === r.requesterId)!;
      const own = e.state.ships.find((s) => s.id === requester.assignedShipId);
      const ready =
        r.kind !== 'escort' ||
        (ship.current?.action.type === 'ESCORT' && dist(ship, own ?? ship) < 60);
      if (own && !own.current && ready) {
        const result = issue(e, requester.id, r, r.followUp);
        if (result.ok) {
          r.followUp = null;
          r.started = true;
        }
      }
    }
  }
  for (const task of e.state.admiralTasks.filter(
    (t) => t.status === 'completed' && !e.state.settledOutcomes.includes(t.id + ':settled'),
  )) {
    if (task.controlMode === 'direct' || readyConditions(e, task, 'after'))
      settleContract(e, task, true, '真实任务与后置条件完成');
  }
}
export function validateResolution(
  e: SimulationEngine,
  command: Extract<Command, { type: 'resolveProposal' }>,
) {
  const c = findContract(e, command.contractId);
  if (
    !c ||
    c.conditionVersion !== command.version ||
    e.state.settledOutcomes.includes(c.id + ':settled')
  )
    return no('请求不存在、已经结束或版本已变化');
  if (command.response === 'approve') {
    if (c.creditsApproved) return no('条件已经确认，不得重复批准');
    if (
      isTask(c) ? !['negotiating', 'accepted'].includes(c.consent) : c.status !== 'awaitingApproval'
    )
      return no('当前没有待确认条件');
    const credits = c.conditions.reduce((sum, c) => sum + (c.type === 'reward' ? c.credits : 0), 0);
    if (!c.creditsApproved && credits > e.state.resources.credits) return no('奖励预算不足');
  }
  if (command.response === 'takeover' && !isTask(c)) return no('同僚请求请用地图舰船指令接管');
  return ok();
}
export function applyResolution(
  e: SimulationEngine,
  command: Extract<Command, { type: 'resolveProposal' }>,
) {
  const c = findContract(e, command.contractId)!;
  if (command.response === 'approve') approveContract(e, c);
  else if (command.response === 'takeover' && isTask(c)) {
    if (e.state.commitments.some((p) => p.contractId === c.id && p.status === 'pending'))
      settleContract(e, c, false, '直接接管中止了尚未兑现的约定', 'cancel');
    c.controlMode = 'direct';
    c.consent = 'accepted';
    c.status = 'active';
    for (const ship of e.state.ships)
      if (ship.current?.taskId === c.id) ship.current.controlMode = 'direct';
    const a = e.state.agents.find((a) => a.id === c.agentId)!;
    personalFeedback(a, c.id + ':takeover', { trust: -3, morale: -3, resentment: 4 });
    wakeAgent(a, 'admiralDirective', e.state.time, true);
    a.decision.pendingReasons = [];
    a.decision.events = [];
  } else {
    if (isTask(c)) {
      c.status = 'cancelled';
      c.consent = 'withdrawn';
    } else c.status = 'cancelled';
    settleContract(e, c, false, 'Admiral 取消安排', 'cancel');
    if (!isTask(c)) c.status = 'cancelled';
    stopContractPlans(e, c.id);
    cancelDescendants(e, c.id);
  }
  return ok('任务协商状态已更新');
}
