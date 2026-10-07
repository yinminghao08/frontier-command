import { worldSchema } from './save-schema';
import type { WorldState } from './types';
export const CURRENT_SAVE_VERSION = 11;
export class UnsupportedSaveVersionError extends Error {}
/** v11 starts a separate world/timeline; earlier files are never rewritten. */
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
