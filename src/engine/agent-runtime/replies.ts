import type { SimulationEngine } from '../engine';
import type { ChatMessage } from '../types';
import { appendChat } from '../chat';
import type { ReplyRecord } from './model';

export function replyRecord(
  e: SimulationEngine,
  sourceMessageId: number,
  recipientAgentId: string,
): ReplyRecord {
  const key = `reply:${sourceMessageId}:${recipientAgentId}`;
  let record = e.state.agentRuntime.replies.find((r) => r.key === key);
  if (!record) {
    record = {
      key,
      sourceMessageId,
      recipientAgentId,
      phase: 'pending',
      primaryMessageId: null,
      error: null,
      revision: 0,
    };
    e.state.agentRuntime.replies.push(record);
  }
  return record;
}
/** The only entry point allowed to commit a primary response. */
export function commitPrimaryReply(
  e: SimulationEngine,
  agentId: string,
  messageId: number,
  content: string,
  kind: 'reply' | 'request' = 'reply',
): ChatMessage | null {
  const parent = e.state.chatMessages.find((m) => m.id === messageId);
  if (!parent) return null;
  const record = replyRecord(e, messageId, agentId);
  if (record.primaryMessageId !== null)
    return e.state.chatMessages.find((m) => m.id === record.primaryMessageId) ?? null;
  if (['cancelled', 'superseded'].includes(record.phase)) return null;
  const message = appendChat(e, agentId, parent.channelId, content, [], kind, {
    origin: 'engine',
    replyTo: messageId,
    eventId: record.key,
  });
  record.primaryMessageId = message.id;
  record.phase = 'committed';
  record.error = null;
  record.revision++;
  if (parent.responses) parent.responses[agentId] = 'replied';
  return message;
}
export function notifyTask(
  e: SimulationEngine,
  agentId: string | null,
  channelId: string,
  eventId: string,
  objectiveId: string,
  content: string,
  danger = false,
) {
  return appendChat(e, agentId ?? 'system', channelId, content, [], danger ? 'danger' : 'report', {
    origin: 'engine',
    eventId,
    requestId: objectiveId,
    purpose: 'information',
  });
}
