import type { Activity, Agent, AgentProfile, Observation, WorldState } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { available } from './inventory';
import { dist } from './navigation';
import { RULES } from './definitions/rules';
export function decisionWorldKey(a: Agent, w: WorldState) {
  return JSON.stringify({
    discoveries: [...w.bodies, ...w.systems]
      .filter((b) => b.discovered && b.survey < 2)
      .map((b) => b.id)
      .sort(),
    freight: w.locations
      .filter(
        (l) =>
          l.owner === 'starfleet' &&
          l.hull > 0 &&
          l.kind === 'mine' &&
          available(w, l.id, 'materials') >= 10,
      )
      .map((l) => [l.id, available(w, l.id, 'materials') >= 50, l.storageFull])
      .sort(),
    needs: w.projects
      .filter((p) => !p.complete && p.stock.materials < p.cost.materials)
      .map((p) => p.id)
      .sort(),
    threats: w.intel
      .filter((i) => i.live && i.hostile && !i.resolved)
      .map((i) => i.id)
      .sort(),
    fatigue: a.fatigue >= 80 ? 'exhausted' : a.fatigue >= 50 ? 'tired' : 'ready',
    trust: Math.floor(a.trust / 20),
    morale: Math.floor(a.morale / 20),
    growth: Math.floor(a.experience / 60),
    peers: Object.entries(a.relationships)
      .map(([id, r]) => [id, Math.floor((r.trust + r.cooperation) / 20)])
      .sort(),
    goal: a.longTermGoal.activity,
  }).slice(0, 19000);
}

export const clampMood = (value: number) => Math.max(0, Math.min(100, value));
/** Identity-local generation must never consume the physical world's RNG. */
export function personalProfile(id: string, seed = 236807): AgentProfile {
  let hash = seed >>> 0;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const value = () => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return 20 + (hash % 71);
  };
  const profile: AgentProfile = {
    patience: value(),
    assertiveness: value(),
    sociability: value(),
    motivations: {
      safety: value(),
      duty: value(),
      profit: value(),
      growth: value(),
      belonging: value(),
    },
    style: (['concise', 'warm', 'formal', 'direct'] as const)[hash % 4],
  };
  if (id === 'ops-horizon')
    return {
      ...profile,
      patience: 72,
      assertiveness: 80,
      sociability: 35,
      style: 'concise',
      motivations: { safety: 60, duty: 92, profit: 25, growth: 78, belonging: 70 },
    };
  if (id === 'ops-meridian')
    return {
      ...profile,
      patience: 88,
      assertiveness: 54,
      sociability: 76,
      style: 'warm',
      motivations: { safety: 90, duty: 70, profit: 78, growth: 55, belonging: 85 },
    };
  return profile;
}
export function personalState(id: string, career: Agent['career'], seed = 236807) {
  const profile = personalProfile(id, seed);
  const activities: Activity[] = ['security', 'logistics', 'exploration', 'growth'];
  const taskPreferences = {
    security: career === 'battle' ? 70 : 30,
    logistics: career === 'logistics' ? 70 : 30,
    exploration: profile.patience,
    growth: profile.motivations.growth,
  };
  const activity = activities.reduce((best, candidate) =>
    taskPreferences[candidate] > taskPreferences[best] ? candidate : best,
  );
  return {
    profile,
    psychology: { stress: 0, confidence: 60, resentment: 0 },
    longTermGoal: { activity, summary: `${activity}：建立可靠的个人成绩与合作关系` },
    taskPreferences,
    rewardCredits: 0,
    feedbackEvents: [] as string[],
  };
}
export function decisionContext(a: Agent, w: WorldState): Observation['decisionContext'] {
  const ship = w.ships.find((s) => s.id === a.assignedShipId);
  const conflicts =
    ship &&
    [ship.current, ...ship.queue, ...ship.suspended].some(
      (d) =>
        d?.source === 'admiral' &&
        !w.admiralTasks.some((t) => t.id === d.taskId && t.controlMode === 'voluntary'),
    )
      ? ['directAdmiralControl']
      : [];
  const willingness = workWillingness(a);
  return {
    willingness,
    riskLimit: clampMood(
      a.personality.riskTolerance +
        (a.psychology.confidence - 50) * 0.2 -
        a.profile.motivations.safety * 0.15 -
        a.fatigue * 0.15,
    ),
    conflicts: [
      ...conflicts,
      ...(ship && ship.hull / capabilities(ship).hull < 0.45 ? ['damagedHull'] : []),
      ...(a.fatigue >= 80 ? ['fatigue'] : []),
    ],
    preferredActivities: (Object.keys(a.taskPreferences) as Activity[]).sort(
      (l, r) => a.taskPreferences[r] - a.taskPreferences[l],
    ),
    preferredPeers: Object.entries(a.relationships)
      .sort(([, l], [, r]) => r.trust + r.cooperation - l.trust - l.cooperation)
      .map(([id]) => id),
    growthModules:
      a.longTermGoal.activity === 'logistics'
        ? ['expandedCargo']
        : a.longTermGoal.activity === 'security'
          ? ['precisionTargeting', 'reinforcedShields']
          : ['longRangeSensors', 'deepScan'],
    preparation: ship
      ? {
          hullPercent: (ship.hull / capabilities(ship).hull) * 100,
          freeCargo: capabilities(ship).cargo - cargoUsed(ship),
          repairMaterials: Math.max(
            0,
            (capabilities(ship).hull - ship.hull + 200 - ship.engines - ship.weapons) /
              RULES.repairPerMaterial,
          ),
          facilities: w.locations
            .filter((l) => l.owner === 'starfleet' && l.hull > 0)
            .map((l) => ({
              id: l.id,
              distance: dist(ship, l),
              materialsAvailable: available(w, l.id, 'materials'),
            }))
            .sort((l, r) => l.distance - r.distance),
        }
      : null,
  };
}
export function workWillingness(
  a: Pick<Agent, 'morale' | 'trust' | 'personality' | 'profile' | 'fatigue' | 'psychology'>,
) {
  return clampMood(
    a.morale * 0.35 +
      a.trust * 0.25 +
      a.personality.discipline * 0.2 +
      a.profile.motivations.duty * 0.2 -
      a.fatigue * 0.55 -
      a.psychology.stress * 0.2 -
      a.psychology.resentment * 0.3,
  );
}
export function personalFeedback(
  a: Agent,
  eventId: string,
  change: Partial<Agent['psychology']> & {
    trust?: number;
    morale?: number;
    activity?: Activity;
    preference?: number;
  },
) {
  if (a.feedbackEvents.includes(eventId)) return false;
  a.feedbackEvents.push(eventId);
  for (const key of ['stress', 'confidence', 'resentment'] as const)
    a.psychology[key] = clampMood(a.psychology[key] + (change[key] ?? 0));
  a.trust = clampMood(a.trust + (change.trust ?? 0));
  a.morale = clampMood(a.morale + (change.morale ?? 0));
  if (change.activity)
    a.taskPreferences[change.activity] = clampMood(
      a.taskPreferences[change.activity] + (change.preference ?? 0),
    );
  return true;
}
