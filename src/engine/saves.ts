import { worldSchema } from './save-schema';
import type { WorldState } from './types';
export const CURRENT_SAVE_VERSION = 12;
export class UnsupportedSaveVersionError extends Error {}
/** Upgrade structure only: historical chat never becomes a newly authorized command. */
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 11 && input && typeof input === 'object') {
    const old = structuredClone(input) as Record<string, unknown>;
    old.version = 12;
    old.admiralTasks = [];
    if (Array.isArray(old.agents))
      for (const agent of old.agents) {
        if (
          agent &&
          typeof agent === 'object' &&
          'decision' in agent &&
          agent.decision &&
          typeof agent.decision === 'object'
        )
          Object.assign(agent.decision, {
            lastAdmiralMessageId: typeof old.nextChat === 'number' ? old.nextChat - 1 : 0,
          });
      }
    for (const key of ['ships', 'enemies', 'civilians'])
      if (Array.isArray(old[key]))
        for (const ship of old[key]) {
          if (!ship || typeof ship !== 'object') continue;
          const record = ship as Record<string, unknown>;
          for (const directive of [
            record.current,
            ...(Array.isArray(record.queue) ? record.queue : []),
            ...(Array.isArray(record.suspended) ? record.suspended : []),
          ])
            if (directive && typeof directive === 'object')
              Object.assign(directive, {
                executorAgentId: null,
                sourceMessageId: null,
                taskId: null,
                allowWormholes: true,
              });
        }
    return worldSchema.parse(old);
  }
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
