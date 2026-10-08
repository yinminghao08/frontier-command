import { worldSchema } from './save-schema';
import type { WorldState } from './types';
import { worldSchema as v14Schema } from './legacy-v14/save-schema';
import { freshAgentDynamics } from './definitions/agents';
export const CURRENT_SAVE_VERSION = 15;
export class UnsupportedSaveVersionError extends Error {}
/** Migration validates the frozen old protocol before adding v15 fields. */
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 14) {
    const old = v14Schema.parse(input);
    return worldSchema.parse({
      ...old,
      version: 15,
      agents: old.agents.map((a) => {
        const addressed = old.chatMessages.filter(
          (m) =>
            m.sender === old.commander.id &&
            (m.channelId === 'private:' + a.id ||
              (m.channelId === 'frontier-command' && m.mentions.includes(a.id))),
        );
        return {
          ...a,
          stateDynamics: {
            ...freshAgentDynamics(),
            thresholds: [
              ...(a.fatigue >= 50 ? ['fatigue50'] : []),
              ...(a.fatigue >= 80 ? ['fatigue80'] : []),
              ...(a.psychology.stress >= 60 ? ['stress60'] : []),
              ...(a.psychology.resentment >= 50 ? ['resentment50'] : []),
            ],
          },
          decision: {
            ...a.decision,
            lastAdmiralMessageId: Math.max(
              a.decision.lastAdmiralMessageId,
              0,
              ...addressed.map((m) => m.id),
            ),
            pendingReasons: a.decision.pendingReasons.filter((r) => !r.startsWith('chat:')),
            events: a.decision.events.filter((v) => v.kind !== 'chat'),
          },
        };
      }),
    });
  }
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
