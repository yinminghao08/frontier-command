import { worldSchema } from './save-schema';
import type { WorldState } from './types';
export const CURRENT_SAVE_VERSION = 8;
export class UnsupportedSaveVersionError extends Error {}
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
