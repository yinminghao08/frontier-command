import type { Directive } from './types';
import type { SimulationEngine } from './engine';
import { appendChat, privateChannel, REPORT_CHANNEL } from './chat';
export function directiveFeedback(e: SimulationEngine, d: Directive, text: string, phase: string) {
  const message = e.state.chatMessages.find((m) => m.id === d.sourceMessageId);
  const agent = e.state.agents.find((a) => a.id === d.executorAgentId || a.id === d.actorId);
  appendChat(
    e,
    agent?.id ?? 'system',
    message?.channelId ?? (agent ? privateChannel(agent.id) : REPORT_CHANNEL),
    text,
    [],
    'reply',
    {
      origin: 'engine',
      replyTo: message?.id ?? null,
      eventId: `${d.id}:${d.cycle}:${phase}`.slice(0, 160),
    },
  );
}
