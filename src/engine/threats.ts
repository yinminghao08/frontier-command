import type { Enemy, WorldState } from './types';
import { SHIP_CLASSES } from './definitions/ships';
import { RULES } from './definitions/rules';
import { dist } from './navigation';
/** Enemy rules use their own recent sensor observations plus publicly charted colonies. */
export function decideThreat(w: WorldState, e: Enemy) {
  if (w.time < e.nextDecision) return;
  e.nextDecision = w.time + RULES.decisionInterval;
  const d = SHIP_CLASSES[e.classId];
  const visible = w.ships.filter(
    (s) =>
      s.hull > 0 &&
      s.status !== 'docked' &&
      s.status !== 'repairing' &&
      s.status !== 'rearming' &&
      dist(e, s) <= d.sensors,
  );
  const targets = [
    ...visible.map((s) => {
      const escorts = visible
        .filter((other) => other.id !== s.id && dist(other, s) < 180)
        .reduce((sum, s) => sum + SHIP_CLASSES[s.classId].hull, 0);
      const value =
        Object.values(s.cargo).reduce((a, b) => a + b, 0) * 3 + 35 + (s.x > 1040 ? 80 : 0);
      const defense = s.hull + s.shield + escorts * 0.7;
      return {
        id: s.id,
        x: s.x,
        y: s.y,
        seenAt: w.time,
        score: value - defense * 0.3 - dist(e, s) * 0.08,
      };
    }),
    ...w.locations
      .filter((l) => l.kind === 'colony' && l.regionId === 'federation')
      .map((l) => {
        const escorts = visible
          .filter((s) => dist(s, l) < 200)
          .reduce((sum, s) => sum + s.hull + s.shield, 0);
        const knownSupply = dist(e, l) <= d.sensors ? l.stock.supplies : 30;
        return {
          id: l.id,
          x: l.x,
          y: l.y,
          seenAt: w.time,
          score:
            e.factionId === 'pirate'
              ? 70 + knownSupply * 0.4 - escorts * 0.5 - dist(e, l) * 0.04
              : -200,
        };
      }),
  ];
  e.knownTargets = [
    ...targets,
    ...e.knownTargets.filter((t) => !targets.some((x) => x.id === t.id) && w.time - t.seenAt < 15),
  ].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (e.hull < d.hull * 0.35 || e.loot >= 20 || e.core < 8) {
    e.intent = 'retreat';
    e.targetId = null;
    return;
  }
  if (e.intent === 'retreat') return;
  const best = e.knownTargets[0];
  if (best && best.score > 0 && (e.factionId === 'pirate' || e.classId !== 'scout')) {
    e.targetId = best.id;
    e.intent = e.factionId === 'pirate' ? 'raid' : 'probe';
  } else {
    e.targetId = null;
    e.intent = e.factionId === 'pirate' ? 'retreat' : 'observe';
  }
}
