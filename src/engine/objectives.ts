import type { SimulationEngine } from './engine';
import type { Action, Objective, Command, Directive, Ship } from './types';
import { compileIntent } from './intent-gateway';
import type { TaskIntent } from './intent-gateway';
import { appendChat, COMMAND_CHANNEL, privateChannel, remember, wakeAgent } from './chat';
import { capabilities, cargoUsed } from './capabilities';
import { available, haulLoad, inventory } from './inventory';
import { FACILITIES } from './definitions/progression';
import { dist, routeEstimate } from './navigation';
import { objectiveSchema } from './objective-schema';
import {
  makeRequest,
  readyConditions,
  settleContract,
  liveRequest,
  cancelDescendants,
} from './contracts';
import { hasAdmiralWork } from './fleet';
import { criterionFor } from './agent-runtime/model';
import { goalFromProposal } from './agent-runtime/runtime';
import { commitPrimaryReply } from './agent-runtime/replies';

export function addressedAdmiralMessage(e: SimulationEngine, agentId: string, messageId: number) {
  const w = e.state;
  return w.chatMessages.find(
    (m) =>
      m.id === messageId &&
      m.sender === w.commander.id &&
      (m.channelId === privateChannel(agentId) ||
        (m.channelId === COMMAND_CHANNEL && m.mentions.includes(agentId))),
  );
}
export function cancelObjectives(
  e: SimulationEngine,
  shipId: string | null,
  agentId?: string,
  _stopExecution = true,
) {
  e.runtime.interrupt(shipId, agentId);
}

function report(
  e: SimulationEngine,
  objective: Objective,
  reason: string,
  status: Objective['status'],
) {
  e.runtime.transition(
    e.runtime.register(objective),
    status === 'active' ? 'running' : status,
    reason,
  );
}

export function receiveObjective(
  e: SimulationEngine,
  agentId: string,
  messageId: number,
  intent?: TaskIntent,
  directiveMode: 'REPLACE' | 'QUEUE' | 'INTERRUPT' = 'REPLACE',
) {
  const w = e.state,
    agent = w.agents.find((a) => a.id === agentId)!;
  const message = addressedAdmiralMessage(e, agentId, messageId)!;
  const direct =
    message.controlMode === 'direct' ||
    /^\s*(?:@[^\s]+\s+)?直接接管[，,:：\s]*/.test(message.content);
  const result = intent
    ? { intent, clarification: null }
    : compileIntent(e.getObservation(agentId)!, {
        content: message.content.replace(/^\s*(?:@[^\s]+\s+)?直接接管[，,:：\s]*/, ''),
      });
  agent.decision.lastAdmiralMessageId = messageId;
  if (result.clarification) {
    commitPrimaryReply(e, agentId, message.id, result.clarification, 'request');
    if (direct && message.responses) message.responses[agentId] = 'replied';
    return;
  }
  if (!result.intent) return;
  const goal = result.intent.goal ?? goalFromProposal(result.intent);
  const task: Objective = {
    schemaVersion: 1,
    originInteractionId: 'interaction:' + message.id + ':' + agent.id,
    issuerId: w.commander.id,
    ownerAgentId: agent.id,
    goal,
    constraints: { allowWormholes: result.intent.allowWormholes },
    completionCriteria: criterionFor(goal),
    revision: 0,
    createdAt: w.time,
    updatedAt: w.time,
    originalInstruction: message.content,
    amendments: [],
    ...result.intent,
    id: 'admiral-task-' + w.nextId,
    agentId,
    messageId,
    channelId: message.channelId,
    status: 'active',
    reason: null,
    controlMode:
      direct || ['assign', 'cancel'].includes(result.intent.kind) ? 'direct' : 'voluntary',
    consent: direct || ['assign', 'cancel'].includes(result.intent.kind) ? 'accepted' : 'proposed',
    conditions: result.intent.conditions ?? [],
    conditionHistory: [],
    conditionVersion: 1,
    rounds: 0,
    turnAgentId: agentId,
    creditsApproved: false,
    directiveMode,
  };
  if (!objectiveSchema.safeParse(task).success) {
    if (direct && message.responses) message.responses[agentId] = 'replied';
    appendChat(
      e,
      agentId,
      message.channelId,
      '指令参数超出合法范围，请调整数量、时长或星区坐标。',
      [],
      'request',
      { origin: 'engine', replyTo: message.id },
    );
    return;
  }
  if (task.controlMode === 'direct') cancelObjectives(e, null, agentId);
  if (task.controlMode === 'direct' && message.responses) message.responses[agentId] = 'replied';
  w.nextId++;
  w.objectives.push(task);
  agent.currentGoal = message.content.slice(0, 240);
  wakeAgent(agent, 'interpretInteraction', w.time, true);
  agent.decision.pendingReasons = agent.decision.pendingReasons.filter(
    (reason) => reason !== 'interpretInteraction',
  );
  agent.decision.events = agent.decision.events.filter(
    (event) => event.id !== 'interpretInteraction',
  );
  if (task.consent === 'proposed') {
    wakeAgent(agent, 'proposal:' + task.id, w.time, true);
  }
  e.record(
    'interpretInteraction',
    'Admiral 聊天任务 / ' + agent.name + ' / message ' + messageId + ' / ' + task.kind,
    agentId,
    false,
  );
  e.runtime.register(task);
  if (direct) commitPrimaryReply(e, agent.id, message.id, '已接受直接授权，按完整目标执行。');
  e.runtime.drain();
}
export function proposeDirective(
  e: SimulationEngine,
  c: Extract<Command, { type: 'proposeDirective' }>,
) {
  for (const shipId of c.shipIds) {
    const agent = e.state.agents.find((a) => a.enabled && a.assignedShipId === shipId)!;
    const ship = e.state.ships.find((s) => s.id === shipId)!;
    const m = appendChat(
      e,
      e.state.commander.id,
      privateChannel(agent.id),
      `请 ${ship.name} 执行 ${c.action.type}：${'targetIds' in c.action ? c.action.targetIds.join(' → ') : 'targetId' in c.action ? c.action.targetId : '所选任务'}`,
      [],
      'message',
      { controlMode: 'voluntary', origin: 'engine' },
    );
    (m.responses ??= {})[agent.id] = 'pending';
    receiveObjective(
      e,
      agent.id,
      m.id,
      {
        kind: 'action',
        action: c.action,
        targetId: 'targetId' in c.action ? c.action.targetId : null,
        shipId: null,
        facilityKind: null,
        sectors: [],
        allowWormholes: true,
      },
      c.mode,
    );
  }
}
