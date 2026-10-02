import type { Action, Ship, Snapshot, ReadonlyDeep } from '../engine/types';
import { capabilities } from '../engine/capabilities';
import { dist } from '../engine/navigation';
export const ACTION_LABELS: Record<Action['type'], string> = {
  MOVE: 'Move',
  EXPLORE: 'Explore Sector',
  SURVEY: 'Survey',
  MINE: 'Mine / Extract',
  HAUL: 'Transport / Haul',
  ATTACK: 'Attack',
  DISABLE: 'Disable',
  DRIVE_OFF: 'Drive Off',
  INTERCEPT: 'Intercept',
  SHADOW: 'Shadow',
  ESCORT: 'Escort',
  PATROL: 'Patrol',
  RETREAT: 'Retreat',
  DOCK: 'Dock',
  REPAIR: 'Repair',
  REARM: 'Rearm',
  REFIT: 'Refit',
  UNLOAD: 'Unload',
  RECOVER: 'Recover Cargo',
};
export function actionProgress(
  _world: Snapshot,
  s: ReadonlyDeep<Ship>,
): { text: string; fraction: number | null } {
  if (!s.current)
    return { text: s.status.toUpperCase() + ' · AVAILABLE TO ADMIRAL', fraction: null };
  let at = { x: s.x, y: s.y },
    length = 0;
  for (const p of s.path) {
    length += dist(at, p);
    at = p;
  }
  return {
    text:
      length > 10
        ? '航行约 ' + Math.ceil(length / capabilities(s).warp) + 'm · ' + s.current.note
        : s.current.note || s.current.phase,
    fraction: null,
  };
}
