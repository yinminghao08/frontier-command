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
  return structuredClone({
    version: w.version,
    tick: w.tick,
    time: w.time,
    paused: w.paused,
    speed: w.speed,
    status: w.status,
    pauseReasons: w.pauseReasons,
    commander: w.commander,
    operators: w.operators,
    assignments: w.assignments,
    agents: w.agents,
    chatChannels: w.chatChannels,
    chatMessages: w.chatMessages,
    escortRequests: w.escortRequests,
    losses: w.losses,
    ships: w.ships,
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
export function getObservation(this: SimulationEngine, operatorId: string): Observation | null {
  const assignment = this.state.assignments.find((a) => a.operatorId === operatorId);
  const ship = this.state.ships.find((s) => s.id === assignment?.shipId) ?? null;
  const self = this.state.agents.find((a) => a.id === operatorId) ?? null;
  if (!ship && !self) return null;
  const snap = this.snapshot(),
    examples: Action[] = [];
  const locations = snap.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0);
  if (ship) {
    const cap = capabilities(ship),
      free = Math.floor(cap.cargo - cargoUsed(ship));
    examples.push({ type: 'MOVE', point: { x: ship.x + 20, y: ship.y } }, { type: 'RETURN' });
    for (const sector of frontierSectors(snap.sectors))
      examples.push({ type: 'EXPLORE', sector: { q: sector.q, r: sector.r }, approach: 'remote' });
    for (const t of [...snap.systems, ...snap.bodies].slice(0, 40))
      examples.push({ type: 'SURVEY', targetId: t.id, approach: 'close', deep: false });
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
          const amount = Math.min(50, free, Math.floor(src.available[cargoKind]));
          if (amount > 0)
            examples.push({
              type: 'HAUL',
              sourceId: src.locationId,
              targetId: dst.id,
              cargoKind,
              amount,
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
  return structuredClone({
    time: snap.time,
    operatorId,
    self,
    ship,
    currentTask: ship?.current ?? null,
    fleet: snap.agents.map((a) => ({
      id: a.id,
      name: a.name,
      career: a.career,
      assignedShipId: a.assignedShipId,
      status: a.status,
      currentGoal: a.currentGoal,
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
          plans: journeyOptions(snap, ship, l, self?.personality.riskTolerance),
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
    recentChat: snap.chatMessages
      .filter((m) =>
        snap.chatChannels.some((ch) => ch.id === m.channelId && ch.members.includes(operatorId)),
      )
      .slice(-AGENT_RULES.chatObservationLimit),
    channels: snap.chatChannels.filter((ch) => ch.members.includes(operatorId)),
    escortRequests: snap.escortRequests
      .filter((r) => r.requesterId === operatorId || r.responderId === operatorId)
      .slice(-16),
    opportunities: snap.opportunities,
    legalActions: [...new Set(legal.map((a) => a.type))],
    actionExamples: legal,
  });
}
