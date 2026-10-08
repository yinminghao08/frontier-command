import type { SimulationEngine } from './engine';
import type { Agent, AgentMemory, ChatMessage, WorldState } from './types';
import { AGENT_RULES } from './definitions/agents';
export const COMMAND_CHANNEL = 'frontier-command';
export const REPORT_CHANNEL = 'system-reports';
export const SYSTEM_ACTOR = 'system';
export const privateChannel = (agentId: string) => 'private:' + agentId;
export function remember(
  w: WorldState,
  agent: Agent,
  kind: AgentMemory['kind'],
  summary: string,
  entityId: string | null = null,
  salience = 4,
) {
  agent.memory.push({
    id: Math.max(0, ...agent.memory.map((m) => m.id)) + 1,
    time: w.time,
    kind,
    summary: summary.slice(0, 400),
    entityId,
    salience,
  });
  if (agent.memory.length > AGENT_RULES.memoryLimit) {
    const remove = agent.memory
      .map((m, i) => ({ i, score: m.salience + Math.max(0, 5 - (w.time - m.time) / 120) }))
      .sort((a, b) => a.score - b.score || a.i - b.i)[0];
    agent.memory.splice(remove.i, 1);
  }
}
export function wakeAgent(agent: Agent, reason: string, now: number, invalidate = false) {
  if (!agent.decision.pendingReasons.includes(reason)) agent.decision.pendingReasons.push(reason);
  const kind = reason.startsWith('chat:')
    ? 'chat'
    : /request|escort|proposal/i.test(reason)
      ? 'request'
      : /danger/.test(reason)
        ? 'danger'
        : /manual|retry/.test(reason)
          ? 'manual'
          : /configuration/.test(reason)
            ? 'configuration'
            : reason === 'recovery'
              ? 'recovery'
              : 'opportunity';
  if (!agent.decision.events.some((event) => event.id === reason))
    agent.decision.events.push({ id: reason.slice(0, 160), kind, time: now });
  agent.decision.events = agent.decision.events.slice(-8);
  agent.decision.pendingReasons = agent.decision.pendingReasons.slice(-8);
  if (invalidate) {
    agent.decision.revision++;
    agent.status = agent.assignedShipId ? 'online' : 'unassigned';
  }
  agent.decision.nextAt = Math.min(agent.decision.nextAt, now);
}
export function mentionsIn(w: WorldState, content: string) {
  const names = [
    ...w.agents.map((a) => ({ id: a.id, name: a.name })),
    { id: w.commander.id, name: 'Admiral' },
  ];
  return names
    .filter((a) =>
      new RegExp(
        '@' + a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[\\s，,。:：!！?？])',
        'iu',
      ).test(content),
    )
    .map((a) => a.id);
}
export function chatReason(
  w: WorldState,
  sender: string,
  channelId: string,
  content: string,
  mentions: string[],
) {
  const channel = w.chatChannels.find((c) => c.id === channelId);
  if (!channel || !channel.members.includes(sender)) return '无此会话权限';
  if (channel.kind === 'reports') return '系统报告频道仅允许引擎写入';
  const resolved = [...new Set([...mentions, ...mentionsIn(w, content)])];
  if (resolved.length > 12 || resolved.some((id) => !channel.members.includes(id)))
    return '@ 对象不在当前会话';
  return null;
}
export function appendChat(
  e: SimulationEngine,
  sender: string,
  channelId: string,
  content: string,
  mentions: string[] = [],
  kind: ChatMessage['kind'] = 'message',
  metadata: Pick<
    ChatMessage,
    'purpose' | 'replyTo' | 'origin' | 'eventId' | 'requestId' | 'controlMode'
  > = {},
) {
  if (metadata.eventId) {
    const existing = e.state.chatMessages.find((m) => m.eventId === metadata.eventId);
    if (existing) return existing;
  }
  const origin =
    metadata.origin ??
    (kind === 'message' ? (sender === e.state.commander.id ? 'admiral' : 'agent') : 'engine');
  if (kind === 'report' && origin === 'engine') {
    channelId = REPORT_CHANNEL;
    sender = SYSTEM_ACTOR;
    mentions = [];
  }
  const w = e.state,
    channel = w.chatChannels.find((c) => c.id === channelId)!;
  const ids =
    origin === 'engine' && kind === 'report'
      ? []
      : [...new Set([...mentions, ...mentionsIn(w, content)])];
  const message: ChatMessage = {
    id: w.nextChat++,
    sender,
    channelId,
    time: w.time,
    content: content.slice(0, 2000),
    mentions: ids,
    kind,
    purpose: metadata.purpose ?? (kind === 'request' ? 'request' : 'information'),
    replyTo: metadata.replyTo ?? null,
    origin,
    eventId: metadata.eventId ?? null,
    requestId: metadata.requestId ?? null,
    controlMode: metadata.controlMode ?? 'voluntary',
  };
  w.chatMessages.push(message);
  if (origin === 'engine' || channel.kind === 'reports') return message;
  // The saved transcript is persistent; observations/memory are separately bounded.
  const name = w.agents.find((a) => a.id === sender)?.name ?? 'Admiral';
  for (const agent of w.agents.filter((a) => channel.members.includes(a.id) && a.id !== sender)) {
    remember(
      w,
      agent,
      kind === 'danger' ? 'danger' : 'chat',
      name + ': ' + content.slice(0, 300),
      sender,
      ids.includes(agent.id) ? 6 : 2,
    );
    if (
      kind !== 'error' &&
      message.purpose !== 'acknowledgement' &&
      sender === w.commander.id &&
      (channel.kind === 'private' || ids.includes(agent.id))
    )
      wakeAgent(agent, 'chat:' + message.id, w.time, true);
  }
  return message;
}
export function addAgentChannels(w: WorldState, agent: Agent) {
  const group = w.chatChannels.find((c) => c.id === COMMAND_CHANNEL)!;
  if (!group.members.includes(agent.id)) group.members.push(agent.id);
  const reports = w.chatChannels.find((c) => c.id === REPORT_CHANNEL)!;
  if (!reports.members.includes(agent.id)) reports.members.push(agent.id);
  w.chatChannels.push({
    id: privateChannel(agent.id),
    name: agent.name,
    kind: 'private',
    members: [w.commander.id, agent.id],
    readThrough: 0,
  });
}
