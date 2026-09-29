import { worldSchema } from './save-schema';
import type { WorldState } from './types';
export const CURRENT_SAVE_VERSION = 4;
export class UnsupportedSaveVersionError extends Error {}
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version !== 4) throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
