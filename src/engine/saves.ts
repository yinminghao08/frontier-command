import { worldV1Schema } from './save-v1';
import { worldSchema } from './save-schema';
import { INITIAL_FLEET } from './definitions/ships';
import type { WorldState } from './types';

export const CURRENT_SAVE_VERSION = 2;
export class UnsupportedSaveVersionError extends Error {}

/** Pure migration: preserve saved effective stats, progress and PRNG state. */
export function migrateV1(input: unknown): WorldState {
  const legacy = worldV1Schema.parse(input);
  return worldSchema.parse({
    ...legacy,
    version: CURRENT_SAVE_VERSION,
    ships: legacy.ships.map(({ operatorId: _operatorId, ...ship }) => {
      const definition = INITIAL_FLEET.find((entry) => entry.id === ship.id);
      if (!definition) throw new Error(`Unknown legacy ship: ${ship.id}`);
      return { ...ship, classId: definition.classId, factionId: definition.factionId };
    }),
  });
}

export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 1) return migrateV1(input);
  if (version === CURRENT_SAVE_VERSION) return worldSchema.parse(input);
  if (typeof version === 'number')
    throw new UnsupportedSaveVersionError(`Unsupported save version: ${version}`);
  throw new Error('Missing save version');
}
