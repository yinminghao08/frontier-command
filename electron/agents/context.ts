import type { Observation } from '../../src/engine/types';
/** Task-oriented public projection. It cannot access the authoritative world. */
export function compactObservation(o: Observation) {
  const pending = o.recentChat.filter((m) => m.responses?.[o.operatorId] === 'pending');
  const latest = pending.at(-1);
  const text = latest?.content.toLowerCase() ?? '';
  const task = o.admiralTask
    ? { ...o.admiralTask, reason: o.admiralTask.reason?.slice(0, 240) ?? null }
    : null;
  const ids = new Set<string>();
  if (task?.targetId) ids.add(task.targetId);
  if (o.currentTask?.action && 'targetId' in o.currentTask.action)
    ids.add(o.currentTask.action.targetId);
  for (const a of [task?.action, o.currentTask?.action]) {
    if (a?.type === 'HAUL') {
      ids.add(a.sourceId);
      ids.add(a.targetId);
    }
    if (a?.type === 'ATTACK_SET') for (const id of a.targetIds) ids.add(id);
  }
  const entities = [...o.contacts, ...o.locations, ...o.bodies, ...o.systems];
  for (const t of entities)
    if (
      text &&
      (text.includes(t.id.toLowerCase()) ||
        ('name' in t && t.name && text.includes(t.name.toLowerCase())))
    )
      ids.add(t.id);
  const near = <T extends { id: string; x: number; y: number }>(
    items: readonly T[],
    count: number,
  ) =>
    [...items]
      .sort(
        (a, b) =>
          Number(ids.has(b.id)) - Number(ids.has(a.id)) ||
          (o.ship
            ? Math.hypot(a.x - o.ship.x, a.y - o.ship.y) -
              Math.hypot(b.x - o.ship.x, b.y - o.ship.y)
            : 0) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, count);
  const self = o.self;
  const result = {
    time: o.time,
    operatorId: o.operatorId,
    self: self
      ? {
          id: self.id,
          name: self.name,
          career: self.career,
          experience: self.experience,
          decision: { lastChatId: self.decision.lastChatId, events: self.decision.events },
          personality: self.personality,
          profile: self.profile,
          psychology: self.psychology,
          stateDynamics: self.stateDynamics,
          fatigue: self.fatigue,
          morale: self.morale,
          trust: self.trust,
          skills: self.skills,
          longTermGoal: self.longTermGoal,
          taskPreferences: self.taskPreferences,
          relationships: self.relationships,
          memory: self.memory.slice(-3),
        }
      : null,
    ship: o.ship
      ? {
          id: o.ship.id,
          classId: o.ship.classId,
          hull: o.ship.hull,
          shield: o.ship.shield,
          core: o.ship.core,
          weapons: o.ship.weapons,
          engines: o.ship.engines,
          photon: o.ship.photon,
          quantum: o.ship.quantum,
          cargo: o.ship.cargo,
          modules: o.ship.modules,
          x: o.ship.x,
          y: o.ship.y,
          standing: o.ship.standing,
        }
      : null,
    currentTask: o.currentTask
      ? {
          action: o.currentTask.action,
          phase: o.currentTask.phase,
          note: o.currentTask.note?.slice(0, 240),
          carried: o.currentTask.carried,
          delivered: o.currentTask.delivered,
        }
      : null,
    admiralTask: task,
    taskProposals: o.taskProposals.slice(-2),
    decisionContext: o.decisionContext,
    recentChat: latest
      ? o.recentChat.filter((m) => m.channelId === latest.channelId && m.id <= latest.id).slice(-3)
      : o.recentChat.slice(-4),
    channels: o.channels.map((c) => ({ id: c.id, kind: c.kind })),
    contacts: near(o.contacts, 6),
    locations: near(o.locations, 5).map((l) => ({
      id: l.id,
      name: l.name,
      x: l.x,
      y: l.y,
      owner: l.owner,
      kind: l.kind,
      hull: l.hull,
    })),
    bodies: near(o.bodies, 3).map((b) => ({
      id: b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      kind: b.kind,
      survey: b.survey,
    })),
    inventories: [...o.inventories]
      .sort((a, b) => Number(ids.has(b.locationId)) - Number(ids.has(a.locationId)))
      .slice(0, 6),
    opportunities: o.opportunities.slice(0, 5),
    logisticsNeeds: o.logisticsNeeds.slice(0, 4),
    escortRequests: o.escortRequests.slice(-3),
    piracyIncidents: o.piracyIncidents.slice(-2),
    rescueOptions: o.rescueOptions.slice(0, 4),
    journeys: o.journeys.filter((j) => ids.has(j.targetId) || j.targetId === 'base').slice(0, 3),
    constructionOptions: o.constructionOptions.slice(0, 3),
    company: o.company,
    fleet: o.fleet.slice(0, 5),
    actionExamples: [...o.actionExamples]
      .sort((a, b) => {
        const rank = (a: (typeof o.actionExamples)[number]) =>
          ('targetId' in a && ids.has(a.targetId) ? 20 : 0) +
          (a.type === 'HAUL' && self?.career === 'logistics' ? 8 : 0) +
          (['ATTACK', 'RETREAT', 'REPAIR', 'REST'].includes(a.type) ? 3 : 0);
        return rank(b) - rank(a);
      })
      .slice(0, 18),
  };
  // Optional context is shed before the complete player instruction. Transcript persistence is unaffected.
  const tooLarge = () => Buffer.byteLength(JSON.stringify(result)) > 8200;
  while (tooLarge() && result.recentChat.length > 1) result.recentChat.shift();
  for (const key of [
    'actionExamples',
    'opportunities',
    'journeys',
    'constructionOptions',
    'bodies',
    'taskProposals',
    'fleet',
    'logisticsNeeds',
    'rescueOptions',
  ] as const)
    while (tooLarge() && result[key].length) result[key].pop();
  if (tooLarge() && result.self) {
    result.self.memory = [];
    result.self.relationships = {};
    result.self.stateDynamics = { ...result.self.stateDynamics, recent: [] };
  }
  for (const key of [
    'contacts',
    'locations',
    'inventories',
    'escortRequests',
    'piracyIncidents',
  ] as const)
    while (tooLarge() && result[key].length) result[key].pop();
  return result;
}
