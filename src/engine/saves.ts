import { worldV1Schema } from './save-v1';
import { worldV2Schema } from './save-v2';
import { worldSchema } from './save-schema';
import { INITIAL_FLEET } from './definitions/ships';
import { LOCATIONS, regionAt } from './definitions/locations';
import type { WorldState } from './types';

export const CURRENT_SAVE_VERSION = 3;
export class UnsupportedSaveVersionError extends Error {}

/** Pure migration: retain effective stats, positions, routes, timers and PRNG state. */
export function migrateV2(input: unknown): WorldState {
  const legacy = worldV2Schema.parse(input);
  return worldSchema.parse({
    ...legacy,
    version: CURRENT_SAVE_VERSION,
    speed: legacy.speed === 2 ? 1 : legacy.speed,
    pauseReasons: [],
    locations: [
      ...legacy.locations.map((location) => ({ ...location, regionId: regionAt(location.x) })),
      ...LOCATIONS.filter(
        (location) => !legacy.locations.some((saved) => saved.id === location.id),
      ),
    ],
    missions: legacy.missions.map((mission) => ({
      ...mission,
      requirement: mission.requirement.replaceAll('秒', '游戏分钟'),
      result: mission.result.replaceAll('秒', '游戏分钟'),
    })),
    logs: legacy.logs.map((log) => ({ ...log, text: log.text.replaceAll('秒', '游戏分钟') })),
  });
}
export function migrateV1(input: unknown): WorldState {
  const legacy = worldV1Schema.parse(input);
  return migrateV2({
    ...legacy,
    version: 2,
    ships: legacy.ships.map(({ operatorId: _operatorId, ...ship }) => {
      const definition = INITIAL_FLEET.find((entry) => entry.id === ship.id);
      if (!definition) throw new Error('Unknown legacy ship: ' + ship.id);
      return { ...ship, classId: definition.classId, factionId: definition.factionId };
    }),
  });
}
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 1) return migrateV1(input);
  if (version === 2) return migrateV2(input);
  if (version === CURRENT_SAVE_VERSION) return worldSchema.parse(input);
  if (typeof version === 'number')
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  throw new Error('Missing save version');
}
