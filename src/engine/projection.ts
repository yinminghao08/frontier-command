import { productionQuotes } from './production';
import type { SimulationEngine } from './engine';
import type { Action, Observation, Opportunity, Snapshot, Stock } from './types';
import { visibleIntel } from './sensors';
import { frontierSectors, sectorId } from './world-generation';
import { available } from './command-system';
import { GOODS } from './types';
import { markerRemovalReason } from './map-markers';
import { mineAccidentResponse } from './world-events';
import { validateAutonomousAction } from './agents';
import { capabilities, cargoUsed } from './capabilities';
import { journeyOptions } from './journey';
import { AGENT_RULES } from './definitions/agents';
import { FACILITIES } from './definitions/progression';
import { decisionContext } from './personality';
export function opportunities(e: SimulationEngine): Opportunity[] {
  const w = e.state,
    result: Opportunity[] = [];
  for (const s of frontierSectors(w.sectors))
    result.push({
      id: 'explore:' + sectorId(s),
      kind: 'exploration',
      targetId: sectorId(s),
      text: 'UNKNOWN SPACE ' + s.q + '/' + s.r + ' · 可测绘',
    });
  for (const b of w.bodies.filter((b) => b.discovered && b.kind === 'resource' && b.remaining > 0))
    result.push({
      id: 'mine:' + b.id,
      kind: 'mining',
      targetId: b.id,
      text: b.name + (b.survey < 2 ? ' · 需要近距调查' : ' · 可建设矿场'),
    });
  for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)) {
    if (l.kind === 'mine' && l.stock.materials >= 10)
      result.push({
        id: 'freight:' + l.id,
        kind: 'logistics',
        targetId: l.id,
        text: l.name + ' · ' + Math.floor(l.stock.materials) + ' Materials 等待运输',
      });
    if (l.distress && w.time - l.attackedAt <= 30)
      result.push({
        id: 'defend:' + l.id,
        kind: 'security',
        targetId: l.id,
        text: l.name + ' · 请求防卫',
      });
  }
  for (const c of visibleIntel(w).filter((c) => c.live && c.hostile))
    result.push({
      id: 'threat:' + c.id,
      kind: 'security',
      targetId: c.id,
      text: '已观测敌对接触 · ' + (c.name ?? c.id),
    });
  for (const p of w.projects.filter((p) => !p.complete))
    result.push({
      id: 'build:' + p.id,
      kind: 'construction',
      targetId: p.id,
      text: p.name + ' · 等待现场物资/施工',
    });
  return result;
}
export function snapshot(this: SimulationEngine): Snapshot {
  const w = this.state,
    bodies = w.bodies.filter((b) => b.discovered),
    ids = new Set(bodies.map((b) => b.id));
  const publicPoints = [
    ...w.ships,
    ...w.civilians,
    ...visibleIntel(w),
    ...w.locations.filter((l) => l.owner === 'starfleet' || l.discovered),
  ];
  const knownPoint = (p: { x: number; y: number }) =>
    publicPoints.some((x) => Math.hypot(x.x - p.x, x.y - p.y) < 20);
  const knownRuntimeId=new Set([w.commander.id,...w.ships.map(s=>s.id),...w.civilians.map(s=>s.id),...w.intel.map(i=>i.id),...w.agents.map(a=>a.id),...w.objectives.map(o=>o.id),...w.escortRequests.map(r=>r.id),...w.locations.filter(l=>l.owner==='starfleet'||l.discovered).map(l=>l.id),...w.systems.filter(s=>s.discovered).map(s=>s.id),...bodies.map(b=>b.id),...w.wrecks.filter(x=>x.discovered).map(x=>x.id),...w.projects.map(p=>p.id),...w.agentRuntime.tasks.map(t=>t.taskId)]);
  const publicId=(id:string|null)=>id!==null&&knownRuntimeId.has(id)?id:null;
  return structuredClone({
    version: w.version,
    piracyIncidents: w.piracyIncidents.map(({ notifiedAgentIds, ...i }) => ({
      ...i,
      notifiedAgentIds: [],
      attackerIds: i.attackerIds.filter((id) => w.intel.some((c) => c.id === id)),
    })),
    tick: w.tick,
    time: w.time,
    paused: w.paused,
    speed: w.speed,
    status: w.status,
    pauseReasons: w.pauseReasons,
    commander: w.commander,
    operators: w.operators,
    assignments: w.assignments,
    agents: w.agents.map(a=>({...a,assignedShipId:a.assignedShipId,memory:a.memory.map(m=>({...m,entityId:publicId(m.entityId)}))})),
    chatChannels: w.chatChannels,
    chatMessages: w.chatMessages,
    objectives: w.objectives,
    agentRuntime: {
      ...w.agentRuntime,
      events: w.agentRuntime.events.filter(event => event.taskId !== null).map(event=>event.type==='cargoTransfer'?{...event,sourceId:publicId(event.sourceId)??'unknown',payload:{...event.payload,sourceId:publicId(event.payload.sourceId),targetId:publicId(event.payload.targetId)}}:event),
      tasks:w.agentRuntime.tasks.map(task=>({...task,completionEvidence:task.completionEvidence.map(proof=>({...proof,sourceId:publicId(proof.sourceId),targetId:publicId(proof.targetId)}))})),
      cargoLots:w.agentRuntime.cargoLots.filter(lot=>w.ships.some(s=>s.id===lot.shipId)).map(lot=>({...lot,sourceId:publicId(lot.sourceId)})),
    },
    escortRequests: w.escortRequests,
    commitments: w.commitments,
    losses: w.losses,
    ships: w.ships.map(s=>({...s,lastAttackerId:publicId(s.lastAttackerId)})),
    contacts: visibleIntel(w),
    siteContacts: w.siteIntel
      .filter((i) => !w.locations.find((l) => l.id === i.locationId)?.discovered)
      .map(({ id, x, y, progress, lastSeen }) => ({ id, x, y, progress, lastSeen })),
    sectors: w.sectors.filter((s) => s.discovered),
    systems: w.systems
      .filter((s) => s.discovered)
      .map((s) => ({ ...s, bodyIds: s.bodyIds.filter((id) => ids.has(id)) })),
    bodies: bodies.map((b) =>
      b.survey >= 2
        ? b
        : { ...b, remaining: 0, richness: 0, hazard: 0, specialClaimed: false, population: 0 },
    ),
    locations: w.locations
      .filter((l) => l.owner === 'starfleet' || l.discovered)
      .map((l) =>
        l.owner === 'starfleet'
          ? l
          : {
              ...l,
              stock: { materials: 0, photon: 0, quantum: 0, specialFinds: 0 },
              core: 0,
              lastAttackerId: null,
              production: 0,
              capacity: { materials: 0, photon: 0, quantum: 0, specialFinds: 0 },
              colony: null,
              extracted: 0,
              storageFull: false,
            },
      ),
    projects: w.projects,
    jobs: w.jobs,
    wrecks: w.wrecks.filter((x) => x.discovered),
    resources: w.resources,
    baseResources: {
      credits: w.resources.credits,
      stock: this.base.stock,
      available: Object.fromEntries(GOODS.map((k) => [k, available(w, 'base', k)])) as Stock,
      reserved: Object.fromEntries(
        GOODS.map((k) => [k, this.base.stock[k] - available(w, 'base', k)]),
      ) as Stock,
    },
    inventories: w.locations
      .filter((l) => l.owner === 'starfleet' && l.hull > 0)
      .map((l) => ({
        locationId: l.id,
        available: Object.fromEntries(GOODS.map((k) => [k, available(w, l.id, k)])) as Stock,
        reserved: Object.fromEntries(
          GOODS.map((k) => [k, l.stock[k] - available(w, l.id, k)]),
        ) as Stock,
      })),
    production: productionQuotes(w),
    renamedEntityIds: w.renamedEntityIds.filter((id) =>
      [
        ...w.ships,
        ...w.locations.filter((l) => l.owner === 'starfleet' || l.discovered),
        ...w.systems.filter((s) => s.discovered),
        ...bodies,
        ...w.projects,
        ...w.groups,
        ...w.losses.map((l) => ({ id: l.shipId })),
      ].some((e) => e.id === id),
    ),
    mapMarkers: {
      dismissedIds: w.dismissedMarkerIds.filter(
        (id) =>
          bodies.some((b) => b.id === id) || w.wrecks.some((x) => x.id === id && x.discovered),
      ),
      removableIds: [
        ...bodies.filter((b) => b.kind === 'derelict'),
        ...w.wrecks.filter((x) => x.discovered),
      ]
        .filter((x) => !markerRemovalReason(w, x.id))
        .map((x) => x.id)
        .sort(),
    },
    upgrades: w.upgrades,
    tension: w.tension,
    communications: w.communications,
    logs: w.logs,
    history: w.history,
    beams: w.beams.filter((b) => knownPoint(b.from) && knownPoint(b.to)),
    groups: w.groups,
    personnel: w.personnel,
    events: w.events
      .filter((v) =>
        [
          ...w.locations.filter((l) => l.owner === 'starfleet' || l.discovered),
          ...w.ships,
          ...w.civilians,
          ...w.bodies.filter((b) => b.discovered),
          ...w.wrecks.filter((x) => x.discovered),
          ...w.wormholes.filter((h) => h.discovered),
        ].some((x) => x.id === v.subjectId),
      )
      .map((v) => ({
        ...v,
        ...(v.kind === 'accident' ? { accidentResponse: mineAccidentResponse(this, v) } : {}),
        assetIds: v.assetIds.filter((id) => visibleIntel(w).some((i) => i.id === id)),
      })),
    wormholes: w.wormholes
      .filter((h) => h.discovered)
      .map(({ exit, exitSector, ...publicHole }) => ({
        ...publicHole,
        exit: publicHole.surveyed ? exit : null,
      })),
    civilians: w.civilians,
    trade: w.trade,
    opportunities: opportunities(this),
    armory: {
      stock: { photon: this.base.stock.photon, quantum: this.base.stock.quantum },
      reserved: {
        photon: this.base.stock.photon - available(w, 'base', 'photon'),
        quantum: this.base.stock.quantum - available(w, 'base', 'quantum'),
      },
    },
  });
}
export function getObservation(this: SimulationEngine, operatorId: string, includeActions=true): Observation | null {
  const assignment = this.state.assignments.find((a) => a.operatorId === operatorId);
  const ship = this.state.ships.find((s) => s.id === assignment?.shipId) ?? null;
  const self = this.state.agents.find((a) => a.id === operatorId) ?? null;
  if (!ship && !self) return null;
  const snap = this.snapshot(),
    examples: Action[] = [];
  const locations = snap.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0);
  if (ship&&includeActions) {
    const cap = capabilities(ship),
      free = Math.floor(cap.cargo - cargoUsed(ship));
    examples.push({ type: 'MOVE', point: { x: ship.x + 20, y: ship.y } }, { type: 'RETURN' });
    for (const sector of frontierSectors(snap.sectors))
      examples.push({ type: 'EXPLORE', sector: { q: sector.q, r: sector.r }, approach: 'remote' });
    for (const t of [...snap.systems, ...snap.bodies])
      examples.push({ type: 'SURVEY', targetId: t.id, approach: 'close', deep: false });
    if (ship.modules.includes('deepScan'))
      for (const t of [...snap.systems, ...snap.bodies])
        examples.push({ type: 'SURVEY', targetId: t.id, approach: 'close', deep: true });
    for (const h of snap.wormholes) examples.push({ type: 'TRANSIT', targetId: h.id });
    for (const event of snap.events.filter((v) => ['reported', 'responding'].includes(v.stage)))
      examples.push({ type: 'ASSIST_EVENT', targetId: event.id });
    for (const target of snap.locations.filter((l) => l.occupation === 'ruined'))
      examples.push({ type: 'CAPTURE', targetId: target.id });
    for (const i of snap.contacts) {
      examples.push(
        ...(['ATTACK', 'DISABLE', 'DRIVE_OFF', 'INTERCEPT', 'SHADOW'] as const).map((type) => ({
          type,
          targetId: i.id,
        })),
      );
      if (i.live && i.factionId === 'romulan')
        examples.push({ type: 'HAIL', targetId: i.id, message: 'deescalate' });
    }
    for (const l of snap.locations.filter((l) => l.owner !== 'starfleet' && l.hull > 0))
      for (const type of ['ATTACK', 'DISABLE', 'DRIVE_OFF', 'INTERCEPT'] as const)
        examples.push({ type, targetId: l.id });
    for (const t of [...snap.ships, ...snap.civilians].filter((s) => s.id !== ship.id))
      examples.push({ type: 'ESCORT', targetId: t.id });
    for (const l of locations) {
      examples.push({ type: 'PATROL', targetId: l.id, duration: 30 });
      examples.push({ type: 'REST', targetId: l.id, duration: 30 });
      for (const type of ['RETREAT', 'DOCK', 'REPAIR', 'UNLOAD'] as const)
        examples.push({ type, targetId: l.id });
      const stock = snap.inventories.find((i) => i.locationId === l.id)?.available;
      if (stock)
        examples.push({
          type: 'REARM',
          targetId: l.id,
          load: {
            photon: Math.min(cap.photon - ship.photon, Math.floor(stock.photon)),
            quantum: Math.min(cap.quantum - ship.quantum, Math.floor(stock.quantum)),
          },
        });
      for (const moduleId of [
        'deepScan',
        'longRangeSensors',
        'precisionTargeting',
        'reinforcedShields',
        'expandedCargo',
      ] as const)
        examples.push({
          type: 'REFIT',
          targetId: l.id,
          moduleId,
          remove: ship.modules.includes(moduleId),
        });
    }
    for (const src of snap.inventories)
      for (const dst of [...locations, ...snap.projects.filter((p) => !p.complete)].filter(
        (l) => l.id !== src.locationId,
      )) {
        for (const cargoKind of GOODS) {
          const amount = Math.min(free, Math.floor(src.available[cargoKind]));
          if (amount > 0)
            examples.push({
              type: 'HAUL',
              sourceId: src.locationId,
              targetId: dst.id,
              cargoKind,
              amount,
              loadPolicy: 'auto',
              route: 'safe',
              repeat: false,
            });
        }
      }
    for (const wreck of snap.wrecks) examples.push({ type: 'RECOVER', targetId: wreck.id });
  }
  const legal = ship ? examples.filter((a) => validateAutonomousAction(this, ship, a).ok) : [];
  const sources = snap.inventories
    .filter((i) => i.available.materials >= 10)
    .map((i) => i.locationId);
  const taskProposals = snap.objectives.filter(
    (t) =>
      t.agentId === operatorId &&
      t.controlMode === 'voluntary' &&
      ['active', 'blocked'].includes(t.status) &&
      ['proposed', 'negotiating'].includes(t.consent),
  );
  const objective =
    [...taskProposals].reverse().find((t) => t.turnAgentId === operatorId) ??
    [...snap.objectives]
      .reverse()
      .find(
        (t) =>
          (t.agentId === operatorId || snap.agentRuntime.tasks.find(root=>root.objectiveId===t.id)?.execution.carrierAgentId === operatorId) &&
          ['active', 'blocked'].includes(t.status),
      ) ??
    null;
  const constructionOptions = snap.bodies
    .filter((b) => b.kind === 'resource' || b.kind === 'planet')
    .map((b) => {
      const kind = b.kind === 'resource' ? ('mine' as const) : ('colony' as const);
      const result = this.validate({ type: 'startConstruction', siteId: b.id, kind, name: b.name });
      return {
        siteId: b.id,
        kind,
        credits: FACILITIES[kind].cost.credits,
        materials: FACILITIES[kind].cost.materials,
        allowed: result.ok,
        reason: result.reason,
      };
    });
  const readableChat = snap.chatMessages.filter(
    (m) =>
      m.kind !== 'report' &&
      snap.chatChannels.some(
        (ch) => ch.kind !== 'reports' && ch.id === m.channelId && ch.members.includes(operatorId),
      ),
  );
  const selectedChat = new Map<number, Snapshot['chatMessages'][number]>();
  const candidates = [
    ...readableChat.filter((m) => m.responses?.[operatorId] === 'pending').reverse(),
    ...readableChat
      .filter((m) => m.channelId === 'private:' + operatorId)
      .slice(-12)
      .reverse(),
    ...readableChat
      .filter((m) => m.mentions.includes(operatorId))
      .slice(-8)
      .reverse(),
    ...readableChat
      .filter((m) => m.channelId === 'frontier-command')
      .slice(-4)
      .reverse(),
    ...readableChat.slice(-AGENT_RULES.chatObservationLimit).reverse(),
  ];
  for (const message of candidates)
    if (selectedChat.size < AGENT_RULES.chatObservationLimit && !selectedChat.has(message.id))
      selectedChat.set(message.id, message);
  return structuredClone({
    time: snap.time,
    events:snap.events,
    piracyIncidents: snap.piracyIncidents.filter(
      (i) =>
        i.shipId === ship?.id ||
        snap.contacts.some((c) => c.hostile && i.attackerIds.includes(c.id)),
    ),
    wrecks: snap.wrecks,
    rescueOptions: ship
      ? snap.agents
          .filter(
            (a) => a.id !== operatorId && a.career === 'battle' && a.enabled && a.assignedShipId,
          )
          .map((a) => ({ agentId: a.id, action: { type: 'ESCORT' as const, targetId: ship.id } }))
      : [],
    operatorId,
    self:snap.agents.find(a=>a.id===operatorId)??null,
    ship:snap.ships.find(s=>s.id===ship?.id)??null,
    currentTask: ship?.current ?? null,
    objective,
    runtimeTask: objective?snap.agentRuntime.tasks.find(t=>t.objectiveId===objective.id)??null:null,
    objectiveContext:snap.objectives.filter(t=>t.ownerAgentId===operatorId&&['active','blocked','interrupted'].includes(t.status)),
    taskContext:snap.agentRuntime.tasks.filter(t=>t.ownerAgentId===operatorId),
    taskProposals,
    constructionOptions,
    actionAvailability: ship
      ? examples.map((action) => {
          const result = validateAutonomousAction(this, ship, action);
          return { action, autonomous: result.ok, reason: result.ok ? null : result.reason };
        })
      : [],
    fleet: snap.agents.map((a) => ({
      id: a.id,
      name: a.name,
      career: a.career,
      assignedShipId: a.assignedShipId,
      status: a.status,
      currentGoal: (()=>{const ship=snap.ships.find(s=>s.id===a.assignedShipId);return ship?.current?ship.current.action.type+("targetId"in ship.current.action?' / '+ship.current.action.targetId:''):a.status;})(),
    })),
    ownShips: snap.ships,
    contacts: snap.contacts,
    sectors: snap.sectors,
    systems: snap.systems,
    bodies: snap.bodies,
    locations: snap.locations,
    projects: snap.projects,
    wormholes: snap.wormholes,
    journeys: ship
      ? [...locations, ...snap.projects.filter((p) => !p.complete)].slice(0, 24).map((l) => ({
          targetId: l.id,
          plans: journeyOptions(
            snap,
            ship,
            l,
            self?.personality.riskTolerance,
            objective?.allowWormholes ?? true,
          ),
        }))
      : [],
    inventories: snap.inventories,
    logisticsNeeds: [
      ...locations
        .filter((l) => l.kind === 'base')
        .map((l) => ({
          targetId: l.id,
          cargoKind: 'materials' as const,
          amount: Math.max(0, 250 - l.stock.materials),
          sourceIds: sources.filter((id) => id !== l.id),
        })),
      ...snap.projects
        .filter((p) => !p.complete)
        .map((p) => ({
          targetId: p.id,
          cargoKind: 'materials' as const,
          amount: Math.max(0, p.cost.materials - p.stock.materials),
          sourceIds: sources,
        })),
    ].filter((n) => n.amount > 0),
    company: {
      credits: snap.resources.credits,
      upgrades: snap.upgrades,
      tension: snap.tension,
      status: snap.status,
    },
    recentChat: [...selectedChat.values()].sort((a, b) => a.id - b.id),
    channels: snap.chatChannels.filter(
      (ch) => ch.kind !== 'reports' && ch.members.includes(operatorId),
    ),
    commitments: snap.commitments.filter((c) => c.agentId === operatorId),
    decisionContext: self
      ? decisionContext(self, this.state)
      : {
          willingness: 0,
          riskLimit: 0,
          conflicts: [],
          preferredActivities: [],
          preferredPeers: [],
          growthModules: [],
          preparation: null,
        },
    escortRequests: snap.escortRequests
      .filter((r) => r.requesterId === operatorId || r.responderId === operatorId)
      .slice(-16),
    opportunities: snap.opportunities,
    legalActions: [...new Set(legal.map((a) => a.type))],
    actionExamples: legal,
  });
}
