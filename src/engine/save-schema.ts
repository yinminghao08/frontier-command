import { directiveSchema as directive } from './directive-schema';
import { objectiveSchema } from './objective-schema';
import { runtimeSchema } from './agent-runtime/model';
import { commitmentSchema } from './condition-schema';
import {
  colonySchema,
  personnelSchema,
  groupSchema,
  eventSchema,
  wormholeSchema,
  tradeSchema,
} from './v9-schema';
import { z } from 'zod';
import {
  actionSchema,
  ammoSchema,
  pointSchema,
  stockSchema,
  moduleSchema,
  standingSchema,
} from './commands';
import { SHIP_CLASSES, type ShipClassId } from './definitions/ships';
import { CRITICAL_KINDS, GOODS } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { orionSchema, piracyIncidentSchema } from './orion/schema';
import { ORION_RULES, ORION_BUILDS } from './definitions/orion';
import {
  agentSchema,
  chatChannelSchema,
  chatMessageSchema,
  escortRequestSchema,
} from './agent-schema';
const n = z.number().finite(),
  nn = n.min(0),
  integer = nn.int(),
  id = z.string().min(1).max(160),
  name = z.string().min(1).max(160);
const classId = z.custom<ShipClassId>(
  (x) => typeof x === 'string' && Object.hasOwn(SHIP_CLASSES, x),
);
const cost = z.object({ credits: nn, materials: nn, specialFinds: integer }).strict();
const ship = pointSchema
  .extend({
    id,
    name,
    classId,
    factionId: z.enum(['starfleet', 'orion', 'romulan']),
    hull: nn,
    shield: nn,
    core: nn,
    photon: integer,
    quantum: integer,
    modules: z.array(moduleSchema),
    engines: nn.max(100),
    weapons: nn.max(100),
    status: z.enum(['docked', 'active', 'idle']),
    current: directive.nullable(),
    queue: z.array(directive).max(32),
    suspended: z.array(directive).max(16),
    standing: standingSchema,
    piracyPolicy: z.enum(['preserveShip', 'preserveCargo', 'manual']),
    path: z.array(pointSchema),
    heading: n,
    cargo: stockSchema,
    passengers: integer,
    cooldowns: z.record(nn),
    ammoAlertActive: z.boolean().optional(),
    lastAttackerId: id.nullable(),
    attackedAt: n,
    scanUntil: nn,
    cloak: z.enum(['off', 'on', 'decloaking']),
    cloakUntil: nn,
    emergencyRetreat: z.object({ point: pointSchema, started: nn }).strict().nullable(),
    tracking: z
      .object({ targetId: id, position: pointSchema, lastSeen: nn, live: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict();
const facilityKind = z.enum(['base', 'colony', 'mine', 'outpost', 'platform']);
const faction = z
  .object({
    reports: z.array(
      pointSchema
        .extend({
          id,
          observerId: id,
          seenAt: nn,
          value: nn,
          defense: nn,
          kind: z.enum(['ship', 'facility']),
        })
        .strict(),
    ),
    credits: nn,
    production: nn,
    losses: z.array(id),
    stance: z.enum(['observe', 'probe', 'patrol', 'reinforce', 'escalate', 'withdraw']),
    pressure: nn,
  })
  .strict();
const communication = z
  .object({
    id: integer,
    time: nn,
    priority: z.enum(['normal', 'high', 'urgent']),
    text: z.string(),
    read: z.boolean(),
    entityId: id.nullable(),
    category: z.enum(['request', 'report', 'threat', 'decision']),
  })
  .strict();
export const worldSchema = z
  .object({
    version: z.literal(16),
    agentRuntime: runtimeSchema,
    orion: orionSchema,
    piracyIncidents: z.array(piracyIncidentSchema),
    tick: integer,
    time: nn,
    seed: integer.max(4294967295),
    initialSeed: integer.max(4294967295),
    paused: z.boolean(),
    speed: z.union([z.literal(1), z.literal(4), z.literal(16)]),
    status: z.enum(['active', 'commandLost']),
    pauseReasons: z.array(
      z
        .object({
          kind: z.enum(CRITICAL_KINDS),
          entityId: id,
          tick: integer,
          time: nn,
          message: z.string(),
        })
        .strict(),
    ),
    commander: z.object({ id, name, rank: name }).strict(),
    operators: z.array(
      z
        .object({
          id,
          name,
          kind: z.enum(['rules', 'agent']),
          availability: z.enum(['available', 'vesselLost']),
        })
        .strict(),
    ),
    assignments: z.array(z.object({ operatorId: id, shipId: id, since: integer }).strict()),
    agents: z.array(agentSchema).max(512),
    chatChannels: z.array(chatChannelSchema),
    chatMessages: z.array(chatMessageSchema),
    objectives: z.array(objectiveSchema),
    escortRequests: z.array(escortRequestSchema),
    commitments: z.array(commitmentSchema),
    settledOutcomes: z.array(id),
    nextChat: integer.positive(),
    losses: z.array(
      z
        .object({
          shipId: id,
          name,
          classId,
          tick: integer,
          position: pointSchema,
          reason: z.string(),
          cargo: stockSchema,
          ammunition: ammoSchema,
          operatorIds: z.array(id),
        })
        .strict(),
    ),
    ships: z.array(ship),
    enemies: z.array(
      ship
        .extend({
          homeId: id,
          role: z.enum(['scout', 'raider', 'warbird', 'interceptor', 'corsair', 'smuggler']),
          intent: z.enum([
            'observe',
            'raid',
            'probe',
            'patrol',
            'retreat',
            'docked',
            'assemble',
            'ambush',
            'extort',
            'disable',
            'board',
            'transfer',
          ]),
          targetId: id.nullable(),
          destination: pointSchema.nullable(),
          nextDecision: nn,
          visited: z.array(z.string()),
          loot: nn,
          localReports: faction.shape.reports,
          lastHostileAt: n,
          lastHostileTargetId: id.nullable(),
          counterTracking: z
            .object({
              position: pointSchema,
              watchers: z.record(
                z
                  .object({
                    exposure: nn.max(100),
                    identified: z.boolean(),
                    lastSeen: nn,
                    position: pointSchema,
                    bearing: n,
                  })
                  .strict(),
              ),
              evading: z.boolean(),
              waypoints: z.array(pointSchema),
              lastSeen: nn,
              checkedAt: nn,
              serial: integer,
            })
            .strict(),
        })
        .strict(),
    ),
    sectors: z.array(
      z
        .object({
          id,
          q: n.int().safe(),
          r: n.int().safe(),
          systemIds: z.array(id),
          discovered: z.boolean(),
        })
        .strict(),
    ),
    systems: z.array(
      pointSchema
        .extend({
          id,
          name,
          sectorId: id,
          discovered: z.boolean(),
          survey: integer.max(2),
          bodyIds: z.array(id),
          starClass: z.enum(['M', 'K', 'G', 'F', 'A', 'giant', 'neutron']),
        })
        .strict(),
    ),
    bodies: z.array(
      pointSchema
        .extend({
          id,
          name,
          systemId: id,
          kind: z.enum(['planet', 'moon', 'belt', 'resource', 'anomaly', 'ruins', 'derelict']),
          category: z.string(),
          population: nn,
          survey: integer.max(2),
          habitable: z.boolean(),
          remaining: nn,
          richness: nn,
          hazard: nn,
          hidden: z.boolean(),
          specialClaimed: z.boolean(),
          discovered: z.boolean(),
        })
        .strict(),
    ),
    locations: z.array(
      pointSchema
        .extend({
          id,
          name,
          label: name,
          kind: facilityKind,
          defenseProfile: z.enum(['orionHQ', 'orionSupply']).optional(),
          owner: z.enum(['starfleet', 'orion', 'romulan']),
          siteId: id.nullable(),
          stock: stockSchema,
          hull: nn,
          maxHull: nn,
          shield: nn,
          maxShield: nn,
          core: nn,
          attackedAt: n,
          lastAttackerId: id.nullable(),
          cooldown: nn,
          distress: z.boolean(),
          discovered: z.boolean(),
          production: nn,
          capacity: stockSchema,

          storageFull: z.boolean(),
          extracted: nn,
          colony: colonySchema.nullable(),
          occupation: z.enum(['ruined', 'secured', 'rebuilding']).nullable(),
        })
        .strict(),
    ),
    projects: z.array(
      pointSchema
        .extend({
          id,
          name,
          kind: facilityKind,
          siteId: id,
          refitLocationId: id.nullable(),
          stock: stockSchema,
          capacity: stockSchema,
          cost,
          work: nn,
          duration: nn,
          complete: z.boolean(),
        })
        .strict(),
    ),
    jobs: z.array(
      z
        .object({
          id,
          kind: z.enum(['ship', 'upgrade', 'manufacture']),
          locationId: id,
          key: id,
          amount: integer,
          work: nn,
          duration: nn,
          complete: z.boolean(),
          cancelled: z.boolean(),
          name,
        })
        .strict(),
    ),
    wrecks: z.array(
      pointSchema.extend({ id, name, stock: stockSchema, discovered: z.boolean(), sourceShipId: id.optional(), sourceClassId: classId.nullable().optional() }).strict(),
    ),
    intel: z.array(
      pointSchema
        .extend({
          id,
          level: z.enum(['CONTACT', 'CLASSIFIED', 'IDENTIFIED', 'TRACKED']),
          strength: nn.max(12),
          lastSeen: nn,
          live: z.boolean(),
          hostile: z.boolean(),
          name: name.optional(),
          factionId: z.enum(['starfleet', 'orion', 'romulan']).optional(),
          classId: classId.optional(),
          hull: nn.optional(),
          shield: nn.optional(),
          velocity: pointSchema,
          resolved: z.boolean(),
          lastAttackTargetId: id.optional(),
          lastAttackAt: nn.optional(),
        })
        .strict(),
    ),
    factions: z.object({ orion: faction, romulan: faction }).strict(),
    siteIntel: z.array(
      pointSchema.extend({ id, locationId: id, progress: nn.max(10), lastSeen: nn }).strict(),
    ),
    recoveredVeil: z.boolean(),
    productionDiscountUnlocked: z.boolean(),
    renamedEntityIds: z.array(id),
    contactAlerts: z.array(
      z.object({ contactId: id, lastAlertAt: nn, hostileAlerted: z.boolean() }).strict(),
    ),
    dismissedMarkerIds: z.array(id),
    tension: nn.max(100),
    resources: z.object({ credits: nn }).strict(),
    upgrades: z
      .object({
        shipyard: integer.max(1),
        armory: integer.max(1),
        sensors: integer.max(1),
        logistics: integer.max(1),
        defense: integer.max(1),
      })
      .strict(),
    groups: z.array(groupSchema),
    personnel: z.array(personnelSchema),
    events: z.array(eventSchema),
    wormholes: z.array(wormholeSchema),
    trade: tradeSchema,
    civilians: z.array(
      ship
        .extend({
          homeId: id,
          orderId: id.nullable(),
          phase: z.enum(['idle', 'loading', 'delivery', 'return']),
          work: nn,
        })
        .strict(),
    ),
    communications: z.array(communication).max(100),
    logs: z
      .array(
        z
          .object({
            id: integer,
            time: nn,
            level: z.enum(['info', 'success', 'warning', 'danger']),
            text: z.string(),
          })
          .strict(),
      )
      .max(180),
    history: z.array(
      z
        .object({ id: integer, time: nn, kind: id, text: z.string(), entityId: id.nullable() })
        .strict(),
    ),
    beams: z.array(
      z
        .object({
          from: pointSchema,
          to: pointSchema,
          enemy: z.boolean(),
          weapon: z.string(),
          expires: nn,
        })
        .strict(),
    ),
    nextId: integer,
    nextLog: integer,
    nextComms: integer,
    nextHistory: integer,
  })
  .strict()
  .superRefine((w, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
    const orionIds = new Set([
      ...w.enemies.filter((s) => s.factionId === 'orion').map((s) => s.id),
      ...w.factions.orion.losses,
    ]);
    const ownIds = new Set(
      [...w.ships, ...w.civilians].map((s) => s.id).concat(w.losses.map((l) => l.shipId)),
    );
    const incidentIds = new Set(w.piracyIncidents.map((i) => i.id));
    if (incidentIds.size !== w.piracyIncidents.length) bad('Duplicate piracy incident');
    for (const i of w.piracyIncidents) {
      if (
        !ownIds.has(i.shipId) ||
        i.created > w.time ||
        i.deadline < i.created ||
        new Set(i.attackerIds).size !== i.attackerIds.length ||
        i.attackerIds.some((id) => !orionIds.has(id)) ||
        i.notifiedAgentIds.some((id) => !w.agents.some((a) => a.id === id))
      )
        bad('Invalid piracy incident reference or time');
    }
    const occupied = new Set<string>();
    const targetRefs = new Set([...ownIds, ...w.locations.map((l) => l.id)]),
      activeTargets = new Set<string>();
    if (
      new Set(w.orion.operations.map((o) => o.id)).size !== w.orion.operations.length ||
      new Set(w.orion.jobs.map((j) => j.id)).size !== w.orion.jobs.length
    )
      bad('Duplicate Orion action ID');
    for (const reports of Object.values(w.orion.intelligence))
      for (const r of reports)
        if (r.seenAt > w.time || !targetRefs.has(r.id) || !orionIds.has(r.observerId))
          bad('Invalid Orion observation');
    for (const r of Object.values(w.orion.robbedTargets))
      if (r.seenAt > w.time) bad('Invalid Orion cargo-batch time');
    for (const op of w.orion.operations) {
      if (
        op.created > w.time ||
        op.phaseAt > w.time ||
        op.report.seenAt > w.time ||
        op.motion.observedAt > w.time ||
        op.taken > op.limit + 1e-7 ||
        new Set(op.members.map((m) => m.shipId)).size !== op.members.length ||
        op.members.some((m) => !orionIds.has(m.shipId)) ||
        !targetRefs.has(op.targetId) ||
        (op.incidentId && !incidentIds.has(op.incidentId)) ||
        op.report.id !== op.targetId
      )
        bad('Invalid Orion operation');
      if (op.status === 'active') {
        if (activeTargets.has(op.targetId)) bad('Overlapping Orion target');
        activeTargets.add(op.targetId);
      }
      if (op.status === 'active')
        for (const m of op.members) {
          if (occupied.has(m.shipId)) bad('Orion ship in overlapping operations');
          occupied.add(m.shipId);
        }
    }
    for (const j of w.orion.jobs) {
      if (
        j.work > j.duration + 1e-7 ||
        (j.builderId && !orionIds.has(j.builderId)) ||
        (j.locationId && !w.locations.some((l) => l.id === j.locationId)) ||
        (j.kind === 'ship' && (!j.classId || !Object.hasOwn(ORION_BUILDS, j.classId))) ||
        ((j.kind === 'supply' || j.kind === 'hq') && !j.builderId)
      )
        bad('Invalid Orion paid job');
      if (j.kind === 'ship' && j.classId && Object.hasOwn(ORION_BUILDS, j.classId)) {
        const d = ORION_BUILDS[j.classId as keyof typeof ORION_BUILDS];
        if (j.credits !== d.credits || j.materials !== d.materials || j.duration !== d.minutes)
          bad('Invalid Orion build payment');
      }
      if (
        j.kind === 'ammo' &&
        (j.materials !== 1 || j.credits !== 4 || j.duration !== 5 || j.builderId || j.classId)
      )
        bad('Invalid Orion ammunition payment');
      if (j.kind === 'hq' || j.kind === 'supply') {
        const cost = j.kind === 'hq' ? ORION_RULES.hqCost : ORION_RULES.supplyCost;
        if (
          j.credits !== cost.credits ||
          j.materials !== cost.materials ||
          j.duration !== cost.minutes ||
          j.classId ||
          j.locationId
        )
          bad('Invalid Orion construction payment');
      }
    }
    if (
      w.enemies.filter((s) => s.factionId === 'orion').length +
        w.orion.jobs.filter((j) => j.kind === 'ship' && j.status === 'active').length >
      ORION_RULES.fleetLimit
    )
      bad('Orion fleet exceeds paid capacity');
    for (const k of GOODS)
      if (w.orion.market.stock[k] > w.orion.market.capacity[k] + 1e-7)
        bad('Orion market exceeds capacity');
    for (const [shipId, loot] of Object.entries(w.orion.lootCargo)) {
      const ship = w.enemies.find((s) => s.id === shipId);
      if (ship && GOODS.some((k) => loot[k] > ship.cargo[k] + 1e-7))
        bad('Orion loot exceeds physical cargo');
    }
    if (
      new Set(w.orion.ledger.map((l) => l.id)).size !== w.orion.ledger.length ||
      w.orion.ledger.some((l) => l.time > w.time)
    )
      bad('Invalid Orion ledger');
    for (const l of w.orion.ledger.filter((l) => l.kind === 'sale'))
      if (
        Math.abs(
          l.credits - GOODS.reduce((n, k) => n + l.goods[k] * ORION_RULES.marketPrices[k], 0),
        ) > 1e-6
      )
        bad('Invalid Orion sale payment');
    for (const p of w.orion.provisioning)
      if (!orionIds.has(p.shipId) || (p.sourceId && !w.locations.some((l) => l.id === p.sourceId)))
        bad('Invalid Orion construction supply reference');
    for (const loss of w.orion.shipLosses)
      if (!w.factions.orion.losses.includes(loss.id) || loss.time > w.time)
        bad('Invalid Orion permanent loss');
    if (
      w.orion.realizedIncome !==
      w.orion.ledger.filter((l) => l.kind === 'sale').reduce((n, l) => n + l.credits, 0)
    ) {
      const delta = Math.abs(
        w.orion.realizedIncome -
          w.orion.ledger.filter((l) => l.kind === 'sale').reduce((n, l) => n + l.credits, 0),
      );
      if (delta > 1e-6) bad('Orion realized income does not match sales');
    }
    for (const t of w.orion.logistics)
      if (
        !orionIds.has(t.shipId) ||
        !w.locations.some((l) => l.id === t.sourceId) ||
        !w.locations.some((l) => l.id === t.targetId)
      )
        bad('Invalid Orion physical supply route');
    for (const ship of [...w.ships, ...w.enemies, ...w.civilians]) {
      for (const d of [ship.current, ...ship.queue, ...ship.suspended])
        if (d && d.action.type === 'HAUL' && (d.lost ?? 0) + d.delivered > d.carried + 1e-7)
          bad('Cargo loss exceeds loaded manifest');
    }
    const agentIds = new Set(w.agents.map((a) => a.id)),
      actors = new Set([w.commander.id, ...agentIds]);
    if (
      agentIds.size !== w.agents.length ||
      new Set(w.agents.map((a) => a.name.toLowerCase())).size !== w.agents.length
    )
      bad('Duplicate Agent identities');
    for (const a of w.agents) {
      const assignment = w.assignments.find((x) => x.operatorId === a.id);
      if (
        !w.operators.some((o) => o.id === a.id && o.kind === 'agent' && o.name === a.name) ||
        (assignment!==undefined&&!w.ships.some(s=>s.id===assignment.shipId))
      )
        bad('Invalid Agent/Operator/Assignment link');
      if (
        a.originPersonnelId &&
        !w.personnel.some(
          (p) =>
            p.id === a.originPersonnelId &&
            p.status === 'available' &&
            p.career === a.career &&
            p.training === 90,
        )
      )
        bad('Invalid Agent training origin');
      if (
        (a.decision.lastAt !== null && a.decision.lastAt > w.time) ||
        a.decision.lastChatId >= w.nextChat ||
        a.decision.lastAdmiralMessageId >= w.nextChat
      )
        bad('Invalid Agent decision clock');
      if (
        new Set(a.feedbackEvents).size !== a.feedbackEvents.length ||
        new Set(a.decision.events.map((event) => event.id)).size !== a.decision.events.length ||
        a.decision.events.some((event) => event.time > w.time)
      )
        bad('Invalid consumed Agent events');
      const dynamics = a.stateDynamics;
      if (
        dynamics.lastDangerAt > w.time ||
        (dynamics.engagementTick !== null && dynamics.engagementTick > w.tick) ||
        new Set(dynamics.hullBands).size !== dynamics.hullBands.length ||
        dynamics.hullBands.some((v) => ![75, 50, 30].includes(v)) ||
        new Set(dynamics.thresholds).size !== dynamics.thresholds.length ||
        dynamics.thresholds.some(
          (v) => !['fatigue50', 'fatigue80', 'stress60', 'resentment50'].includes(v),
        ) ||
        new Set(dynamics.recent.map((v) => v.id)).size !== dynamics.recent.length ||
        dynamics.recent.some((v) => v.time > w.time)
      )
        bad('Invalid Agent state feedback');
      if (
        new Set(a.memory.map((m) => m.id)).size !== a.memory.length ||
        a.memory.some((m) => m.time > w.time)
      )
        bad('Invalid Agent memory');
      if (
        Object.entries(a.relationships).some(
          ([id, r]) => !agentIds.has(id) || id === a.id || r.lastInteraction > w.time,
        )
      )
        bad('Invalid Agent relationship');
    }
    const channelIds = new Set(w.chatChannels.map((c) => c.id));
    if (channelIds.size !== w.chatChannels.length || w.chatChannels.length !== w.agents.length + 2)
      bad('Invalid chat channel count');
    for (const ch of w.chatChannels) {
      if (
        new Set(ch.members).size !== ch.members.length ||
        ch.members.some((id) => !actors.has(id) && !(id === 'system' && ch.kind === 'reports')) ||
        ch.readThrough >= w.nextChat
      )
        bad('Invalid channel membership/read cursor');
      if (
        ch.kind === 'reports'
          ? ch.id !== 'system-reports' ||
            ch.members.length !== actors.size + 1 ||
            !ch.members.includes('system')
          : ch.kind === 'command'
            ? ch.id !== 'frontier-command' || ch.members.length !== actors.size
            : ch.members.length !== 2 ||
              !ch.members.includes(w.commander.id) ||
              !w.agents.some((a) => ch.id === 'private:' + a.id && ch.members.includes(a.id))
      )
        bad('Invalid chat channel');
    }
    if (new Set(w.chatMessages.map((m) => m.id)).size !== w.chatMessages.length)
      bad('Duplicate chat messages');
    const messageEvents = w.chatMessages.flatMap((m) => (m.eventId ? [m.eventId] : []));
    if (new Set(messageEvents).size !== messageEvents.length) bad('Duplicate chat event');
    for (const m of w.chatMessages) {
      const ch = w.chatChannels.find((c) => c.id === m.channelId);
      if (
        !ch?.members.includes(m.sender) ||
        m.mentions.some((id) => !ch.members.includes(id)) ||
        new Set(m.mentions).size !== m.mentions.length ||
        m.time > w.time ||
        m.id >= w.nextChat
      )
        bad('Invalid chat message');
      if (ch?.kind === 'reports' && m.origin !== 'engine' && m.origin !== 'legacy')
        bad('Forged system report');
      if (
        m.responses &&
        (m.sender !== w.commander.id ||
          m.origin !== 'admiral' ||
          Object.keys(m.responses).some(
            (id) =>
              !agentIds.has(id) ||
              !ch?.members.includes(id) ||
              !(ch.kind === 'private' || m.mentions.includes(id)),
          ))
      )
        bad('Invalid reply recipients');
      if (
        m.replyTo &&
        !w.chatMessages.some(
          (previous) =>
            previous.id === m.replyTo && previous.id < m.id && previous.channelId === m.channelId,
        )
      )
        bad('Invalid chat reply chain');
    }
    const taskIds = new Set(w.objectives.map((t) => t.id));
    if (taskIds.size !== w.objectives.length) bad('Duplicate Admiral tasks');
    for (const task of w.objectives) {
      const message = w.chatMessages.find((m) => m.id === task.messageId);
      if (
        (task.ownerAgentId!==null && !agentIds.has(task.ownerAgentId)) ||
        (task.carrierAgentId && !agentIds.has(task.carrierAgentId)) ||
        (task.messageId>0 && (message?.sender !== w.commander.id || message.channelId !== task.channelId || !(message.channelId === 'private:' + task.agentId || (message.channelId === 'frontier-command' && message.mentions.includes(task.agentId))))) ||
        task.sectorIndex > task.sectors.length ||
        new Set(task.scannedSectorIndices).size !== task.scannedSectorIndices.length ||
        task.scannedSectorIndices.some((i) => i >= task.sectors.length) ||
        (task.kind === 'action' && !task.action) ||
        (task.kind === 'assign' && !task.shipId) ||
        (task.kind === 'construction' && (!task.targetId || !task.facilityKind)) ||
        (task.kind === 'surveyRoute' && !task.sectors.length) ||
        (task.kind === 'factionAssault' && task.factionId !== 'orion') ||
        Object.values(task.searchedTargets ?? {}).some((time) => time > w.time)
      )
        bad('Invalid Admiral task authority');
    }
    if (new Set(w.escortRequests.map((r) => r.id)).size !== w.escortRequests.length)
      bad('Duplicate escort requests');
    for (const r of w.escortRequests)
      if (
        !agentIds.has(r.requesterId) ||
        !agentIds.has(r.responderId) ||
        r.requesterId === r.responderId ||
        r.created > w.time ||
        r.deadline < r.created ||
        (r.rescueArrivedAt !== undefined &&
          (r.kind !== 'reinforce' ||
            r.rescueArrivedAt < r.created ||
            r.rescueArrivedAt > w.time)) ||
        ![...w.ships.map((s) => s.id), ...w.losses.map((l) => l.shipId)].includes(r.targetShipId)
      )
        bad('Invalid escort contract');
    const contractIds = new Set([...taskIds, ...w.escortRequests.map((r) => r.id)]);
    if (contractIds.size !== w.objectives.length + w.escortRequests.length)
      bad('Duplicate contract identity');
    if (
      new Set(w.settledOutcomes).size !== w.settledOutcomes.length ||
      new Set(w.commitments.map((c) => c.id)).size !== w.commitments.length
    )
      bad('Duplicate settlement');
    for (const c of w.commitments) {
      if (
        !contractIds.has(c.contractId) ||
        !agentIds.has(c.agentId) ||
        (c.escrow > 0 && (c.condition.type !== 'reward' || c.status !== 'pending')) ||
        (c.condition.type === 'reward' && c.escrow > c.condition.credits)
      )
        bad('Invalid commitment escrow');
      const contract =
        w.objectives.find((t) => t.id === c.contractId) ??
        w.escortRequests.find((r) => r.id === c.contractId);
      if (
        contract &&
        (c.agentId !== ('consent' in contract ? contract.agentId : contract.responderId) ||
          !contract.conditions.some(
            (condition) => JSON.stringify(condition) === JSON.stringify(c.condition),
          ) ||
          (c.condition.type === 'reward' &&
            c.status === 'pending' &&
            (contract.creditsApproved ? c.escrow !== c.condition.credits : c.escrow !== 0)) ||
          (c.condition.type === 'reward' &&
            c.status === 'fulfilled' &&
            !w.settledOutcomes.includes(c.contractId + ':settled')))
      )
        bad('Invalid commitment proof');
    }
    for (const contract of [...w.escortRequests, ...w.objectives]) {
      if (!actors.has(contract.turnAgentId)) bad('Invalid negotiation turn');
      if (new Set(contract.conditions.map((c) => c.type)).size !== contract.conditions.length)
        bad('Duplicate condition');
      for (const condition of contract.conditions) {
        if (
          'locationId' in condition &&
          !w.locations.some((l) => l.id === condition.locationId && l.owner === 'starfleet')
        )
          bad('Invalid condition facility');
        if (condition.type === 'escort' && !agentIds.has(condition.agentId))
          bad('Invalid condition Agent');
      }
    }
    if (
      new Set(w.contactAlerts.map((a) => a.contactId)).size !== w.contactAlerts.length ||
      w.contactAlerts.some(
        (a) => a.lastAlertAt > w.time || !w.intel.some((i) => i.id === a.contactId),
      )
    )
      bad('Invalid contact alert ledger');
    if (
      new Set(w.dismissedMarkerIds).size !== w.dismissedMarkerIds.length ||
      w.dismissedMarkerIds.some(
        (id) =>
          !w.wrecks.some((x) => x.id === id && x.discovered) &&
          !w.bodies.some((b) => b.id === id && b.discovered && b.kind === 'derelict'),
      )
    )
      bad('Invalid dismissed map markers');
    if (Math.abs(w.time - w.tick / 10) > 1e-8) bad('Clock mismatch');
    const collections = [
      w.ships,
      w.enemies,
      w.sectors,
      w.systems,
      w.bodies,
      w.locations,
      w.projects,
      w.jobs,
      w.wrecks,
      w.operators,
      w.groups,
      w.personnel,
      w.events,
      w.wormholes,
      w.civilians,
      w.trade.orders,
      w.siteIntel,
      w.escortRequests,
    ];
    const globalIds = collections.flatMap((c) => c.map((x) => x.id));
    if (new Set(globalIds).size !== globalIds.length) bad('Duplicate stable entity identifiers');
    const base = w.locations.find(
      (l) => l.id === 'base' && l.kind === 'base' && l.owner === 'starfleet',
    );
    if (!base) bad('Missing Dawn');
    if ((w.status === 'commandLost') !== (base?.hull === 0)) bad('Invalid command status');
    const active = new Set(w.ships.map((s) => s.id));
    if (
      w.losses.some((l) => active.has(l.shipId)) ||
      new Set(w.losses.map((l) => l.shipId)).size !== w.losses.length
    )
      bad('Invalid permanent loss archive');
    if (w.ships.some((s) => s.factionId !== 'starfleet' || s.hull <= 0))
      bad('Invalid active fleet');
    const veilRecords = [
      ...w.ships.filter((s) => s.id === 'veil'),
      ...w.losses.filter((s) => s.shipId === 'veil'),
    ];
    if (
      w.ships.some((s) => s.classId === 'veil' && s.id !== 'veil') ||
      w.losses.some((s) => s.classId === 'veil' && s.shipId !== 'veil') ||
      veilRecords.length !== Number(w.recoveredVeil) ||
      veilRecords.some((s) => s.classId !== 'veil')
    )
      bad('Invalid unique reconnaissance vessel');
    if (w.recoveredVeil && !w.bodies.some((b) => b.id === 'veil-derelict' && b.specialClaimed))
      bad('Invalid reconnaissance recovery site');
    const passage = w.wormholes.find((h) => h.id === 'wormhole:0:0');
    if (
      !passage ||
      passage.sectorId !== 'sector:0:0' ||
      passage.x !== 90 ||
      passage.y !== -80 ||
      passage.exitSector.q !== 0 ||
      passage.exitSector.r !== 12 ||
      passage.exit.x !== 90 ||
      passage.exit.y !== 4720
    )
      bad('Missing fixed Dawn passage');
    if (w.ships.some((s) => s.emergencyRetreat && s.emergencyRetreat.started > w.time))
      bad('Invalid emergency retreat');
    if (
      new Set(w.siteIntel.map((i) => i.locationId)).size !== w.siteIntel.length ||
      w.siteIntel.some(
        (i) =>
          i.lastSeen > w.time ||
          !w.locations.some(
            (l) => l.id === i.locationId && l.owner !== 'starfleet' && l.x === i.x && l.y === i.y,
          ),
      )
    )
      bad('Invalid site reconnaissance');
    if (
      w.enemies.some(
        (s) =>
          s.counterTracking.checkedAt > w.time ||
          s.counterTracking.lastSeen > w.time ||
          (!s.counterTracking.evading && s.counterTracking.waypoints.length > 0) ||
          Object.values(s.counterTracking.watchers).some((o) => o.lastSeen > w.time),
      )
    )
      bad('Invalid counter tracking');
    if (
      new Set(w.assignments.map((a) => a.shipId)).size !== w.assignments.length ||
      new Set(w.assignments.map((a) => a.operatorId)).size !== w.assignments.length
    )
      bad('Duplicate assignments');
    for (const a of w.assignments)
      if (
        !active.has(a.shipId) ||
        !w.operators.some((o) => o.id === a.operatorId && o.availability === 'available')
      )
        bad('Invalid operator assignment');
    for (const sec of w.sectors)
      if (sec.systemIds.some((id) => !w.systems.some((s) => s.id === id && s.sectorId === sec.id)))
        bad('Dangling sector reference');
    for (const sys of w.systems)
      if (
        !w.sectors.some((c) => c.id === sys.sectorId) ||
        sys.bodyIds.some((id) => !w.bodies.some((b) => b.id === id && b.systemId === sys.id))
      )
        bad('Dangling system reference');
    for (const b of w.bodies)
      if (!w.systems.some((s) => s.id === b.systemId)) bad('Dangling body reference');
    for (const p of w.projects)
      if (
        p.refitLocationId
          ? p.kind !== 'base' ||
            p.siteId !== p.refitLocationId ||
            !w.locations.some((l) => l.id === p.refitLocationId && l.owner === 'starfleet')
          : p.kind === 'base' ||
            (!w.bodies.some((b) => b.id === p.siteId) && !w.systems.some((s) => s.id === p.siteId))
      )
        bad('Dangling project site');
    for (const l of w.locations) {
      if (
        l.occupation &&
        (l.hull !== 0 ||
          l.shield !== 0 ||
          (l.occupation === 'ruined') === (l.owner === 'starfleet'))
      )
        bad('Invalid occupation state');
      if (
        l.occupation === 'rebuilding' &&
        !w.projects.some((p) => p.refitLocationId === l.id && !p.complete)
      )
        bad('Missing base refit project');
      if (l.hull > l.maxHull || l.shield > l.maxShield) bad('Facility capacity exceeded');
      if (
        l.siteId &&
        !w.bodies.some((b) => b.id === l.siteId) &&
        !w.systems.some((s) => s.id === l.siteId)
      )
        bad('Dangling facility site');
    }
    const directives = w.ships.flatMap((s) =>
      [s.current, ...s.queue, ...s.suspended].filter((d) => d !== null),
    );
    if (new Set(directives.map((d) => d.id)).size !== directives.length)
      bad('Duplicate directives');
    const refs = new Set([
      ...globalIds,
      ...w.intel.map((i) => i.id),
      ...w.losses.map((l) => l.shipId),
      ...w.factions.orion.losses,
      ...w.factions.romulan.losses,
    ]);
    for (const r of w.escortRequests) {
      if (r.parentTaskId && !contractIds.has(r.parentTaskId)) bad('Invalid collaboration parent');
      for (const action of [r.action, r.followUp])
        if (action)
          for (const target of [
            ...('targetId' in action ? [action.targetId] : []),
            ...('sourceId' in action ? [action.sourceId] : []),
          ])
            if (!refs.has(target)) bad('Invalid collaboration action target');
      if (
        r.kind === 'escort' &&
        r.action &&
        (r.action.type !== 'ESCORT' || r.action.targetId !== r.targetShipId)
      )
        bad('Invalid real escort plan');
    }
    const ownDirectives=new Set(w.ships.flatMap(s=>[s.current,...s.queue,...s.suspended]).filter(d=>d!==null).map(d=>d.id));
    for (const d of directives) {
      if(ownDirectives.has(d.id)&&!d.taskId)bad('Own directive lacks an authorized Task');
      if (d.created > w.time) bad('Future directive');
      if (d.contractId && !contractIds.has(d.contractId)) bad('Invalid directive contract');
      if (d.executorAgentId && !agentIds.has(d.executorAgentId)) bad('Invalid executor Agent');
      if(d.taskId) {
        const task=w.agentRuntime.tasks.find(t=>t.taskId===d.taskId);
        const objective=w.objectives.find(o=>o.id===task?.objectiveId);
        if(!task||!objective||d.objectiveId!==objective.id||d.originInteractionId!==objective.originInteractionId||!task.directiveIds.includes(d.id)||objective.allowWormholes!==d.allowWormholes)bad('Invalid FAR directive authority');
      }
      if (
        d.source === 'admiral'
          ? d.actorId !== w.commander.id
          : d.source === 'agent'
            ? !agentIds.has(d.actorId)
            : !d.actorId.startsWith('standing:') &&
              !w.operators.some((o) => o.id === d.actorId && o.kind === 'rules')
      )
        bad('Invalid directive actor');
      if (
        d.journey &&
        (d.journey.legIndex > d.journey.legs.length ||
          d.journey.legs.some(
            (l) =>
              l.type === 'wormhole' &&
              !w.wormholes.some(
                (h) =>
                  h.id === l.wormholeId &&
                  h.discovered &&
                  h.surveyed &&
                  h.exit.x === l.destination.x &&
                  h.exit.y === l.destination.y,
              ),
          ))
      )
        bad('Invalid journey passage');
      const a = d.action;
      const targets = [
        ...('targetId' in a ? [a.targetId] : []),
        ...('sourceId' in a ? [a.sourceId] : []),
        ...(a.type === 'ATTACK_SET' ? a.targetIds : []),
      ];
      if (targets.some((target) => !refs.has(target))) bad('Dangling directive target');
      if (
        a.type === 'ATTACK_SET' &&
        ((d.targetIndex ?? 0) > a.targetIds.length ||
          new Set(d.unconfirmedTargets ?? []).size !== (d.unconfirmedTargets ?? []).length ||
          d.unconfirmedTargets?.some((id) => !a.targetIds.includes(id)))
      )
        bad('Invalid attack sequence progress');
      if (GOODS.some((k) => d.reserved[k] > 0) && !['HAUL', 'LOAD', 'REARM'].includes(a.type))
        bad('Invalid directive reservation');
      if (
        a.type === 'HAUL' &&
        (d.reserved[a.cargoKind] > a.amount ||
          GOODS.some((k) => k !== a.cargoKind && d.reserved[k] > 0))
      )
        bad('Invalid haul reservation');
      if (
        a.type === 'REARM' &&
        (d.reserved.photon > a.load.photon ||
          d.reserved.quantum > a.load.quantum ||
          d.reserved.materials + d.reserved.specialFinds > 0)
      )
        bad('Invalid magazine reservation');
    }
    for (const s of w.ships)
      if (s.queue.some((d) => GOODS.some((k) => d.reserved[k] > 0)))
        bad('Queued directive cannot reserve inventory');
    for (const s of [...w.ships, ...w.enemies, ...w.civilians]) {
      const c = capabilities(s);
      if (
        s.hull > c.hull + 1e-7 ||
        s.shield > c.shield + 1e-7 ||
        s.core > c.core + 1e-7 ||
        s.photon > c.photon ||
        s.quantum > c.quantum ||
        cargoUsed(s) > c.cargo + 1e-7
      )
        bad('Ship capacity exceeded');
      if (s.modules.length > c.moduleSlots || new Set(s.modules).size !== s.modules.length)
        bad('Invalid module slots');
      if (
        (!SHIP_CLASSES[s.classId].cloak && s.cloak !== 'off') ||
        (s.tracking && (s.tracking.lastSeen > w.time || !refs.has(s.tracking.targetId))) ||
        (s.emergencyRetreat && s.emergencyRetreat.started > w.time)
      )
        bad('Invalid vessel observation or cloak');
    }
    for (const enemy of w.enemies)
      if (
        enemy.factionId === 'starfleet' ||
        !w.locations.some((l) => l.id === enemy.homeId) ||
        w.factions[enemy.factionId as 'orion' | 'romulan'].losses.includes(enemy.id)
      )
        bad('Invalid faction asset');
    const members = w.groups.flatMap((g) => g.shipIds);
    if (new Set(members).size !== members.length) bad('Ship belongs to multiple groups');
    for (const g of w.groups)
      if (
        !g.shipIds.includes(g.flagshipId) ||
        new Set(g.shipIds).size !== g.shipIds.length ||
        g.shipIds.some((id) => !active.has(id))
      )
        bad('Invalid group membership');
    for (const holder of [...w.locations, ...w.projects, w.trade])
      for (const k of GOODS)
        if (holder.stock[k] > holder.capacity[k] + 1e-7) bad('Storage capacity exceeded');
    for (const l of w.locations)
      if (
        l.colony?.commanderId &&
        !w.personnel.some(
          (p) =>
            p.id === l.colony!.commanderId && p.posting?.id === l.id && p.status === 'assigned',
        )
      )
        bad('Invalid colony commander');
    for (const p of w.personnel) {
      if (!w.locations.some((l) => l.id === p.originId)) bad('Invalid personnel origin');
      if (p.posting && ![...w.ships, ...w.locations].some((x) => x.id === p.posting!.id))
        bad('Invalid personnel posting');
    }
    for (const v of w.events)
      if (
        !refs.has(v.subjectId) ||
        v.created > w.time ||
        v.deadline < v.created ||
        (v.followUpId && !w.events.some((x) => x.id === v.followUpId))
      )
        bad('Invalid persistent event');
    for (const h of w.wormholes)
      if (!w.sectors.some((s) => s.id === h.sectorId)) bad('Invalid wormhole sector');
    for (const o of w.trade.orders)
      if (
        o.delivered > o.loaded ||
        o.loaded > o.amount ||
        (o.state === 'complete' && o.delivered !== o.amount)
      )
        bad('Invalid physical trade manifest');
    for (const holder of [...w.locations, ...w.projects])
      for (const k of GOODS) {
        const reserved = directives
          .filter((d) => {
            const ref =
              'sourceId' in d.action
                ? d.action.sourceId
                : 'targetId' in d.action
                  ? d.action.targetId
                  : null;
            const p = w.projects.find((p) => p.id === ref && p.complete),
              canonical = p
                ? w.locations.find(
                    (l) =>
                      (p.refitLocationId ? l.id === p.refitLocationId : l.siteId === p.siteId) &&
                      l.kind === p.kind,
                  )?.id
                : ref;
            return canonical === holder.id;
          })
          .reduce((v, d) => v + d.reserved[k], 0);
        if (reserved > holder.stock[k] + 1e-7) bad('Inventory reservation exceeds real stock');
      }
    for (const j of w.jobs) {
      if (j.complete && j.cancelled) bad('Completed production cannot be cancelled');
      if (
        !w.locations.some(
          (l) => l.id === j.locationId && l.kind === 'base' && l.owner === 'starfleet',
        )
      )
        bad('Invalid production base');
      if (j.kind === 'ship' && !['antares', 'peregrine', 'constitution', 'galaxy'].includes(j.key))
        bad('Invalid shipyard recipe');
      if (j.kind === 'upgrade' && !Object.hasOwn(w.upgrades, j.key))
        bad('Invalid strategic upgrade');
      if (j.kind === 'manufacture' && !['photon', 'quantum'].includes(j.key))
        bad('Invalid manufacturing recipe');
    }
    for (const [entries, next] of [
      [w.history, w.nextHistory],
      [w.logs, w.nextLog],
      [w.communications, w.nextComms],
    ] as const) {
      if (
        new Set(entries.map((h) => h.id)).size !== entries.length ||
        entries.some((h) => h.id >= next || h.time > w.time)
      )
        bad('Invalid historical sequence');
    }
    const runtime=w.agentRuntime;
    if(new Set(runtime.tasks.map(t=>t.objectiveId)).size!==w.objectives.length||runtime.tasks.length!==w.objectives.length)bad('Objective must own exactly one Task');
    if(new Set(runtime.tasks.map(t=>t.taskId)).size!==runtime.tasks.length)bad('Duplicate root Task identity');
    const visited=new Set<string>(),visiting=new Set<string>();
    const checkDependencyCycle=(id:string):boolean=>{if(visiting.has(id))return true;if(visited.has(id))return false;visiting.add(id);const task=runtime.tasks.find(t=>t.taskId===id);if(task?.dependencyTaskIds.some(checkDependencyCycle))return true;visiting.delete(id);visited.add(id);return false;};
    if(runtime.tasks.some(t=>checkDependencyCycle(t.taskId)))bad('Cyclic Task dependency');
    for(const task of runtime.tasks) {
      if(!taskIds.has(task.objectiveId)||task.currentStep>task.steps.length||task.updatedAt>w.time||new Set(task.processedEventIds).size!==task.processedEventIds.length)bad('Invalid FAR Task');
      if(new Set(task.dependencyTaskIds).size!==task.dependencyTaskIds.length||task.dependencies.some(d=>!task.dependencyTaskIds.includes(d.taskId)||!runtime.tasks.some(t=>t.taskId===d.taskId)||d.taskId===task.taskId||d.status==='fulfilled'&&!runtime.events.some(event=>event.eventId===d.evidenceEventId&&event.type==='taskDependency'&&event.taskId===task.taskId&&event.payload.childTaskId===d.taskId)))bad('Invalid Task dependency evidence');
      if(task.status==='completed'&&(!task.progress.verified||!task.completionEvidence.some(v=>v.kind==='verified')))bad('Task success lacks evidence');
    }
    if(runtime.consumedSequence>runtime.events.length||runtime.nextEvent!==runtime.events.length+1||runtime.events.some((event,index)=>event.sequence!==index+1||event.eventId!=='domain:'+event.sequence))bad('Invalid event consumption cursor');
    if(new Set(runtime.events.map(e=>e.eventId)).size!==runtime.events.length||runtime.events.some(e=>e.sequence>=runtime.nextEvent||e.simulationTick>w.tick))bad('Invalid domain journal');
    if(new Set(runtime.replies.map(r=>r.key)).size!==runtime.replies.length)bad('Duplicate primary reply identity');
    if(new Set(runtime.interactions.map(i=>i.interactionId)).size!==runtime.interactions.length)bad('Duplicate interaction identity');
    for(const lot of runtime.cargoLots)if(lot.taskId&&!runtime.tasks.some(t=>t.taskId===lot.taskId))bad('Invalid cargo ownership');
    for(const ship of w.ships)for(const kind of GOODS)if(runtime.cargoLots.filter(l=>l.shipId===ship.id&&l.cargoKind===kind).reduce((n,l)=>n+l.amount,0)>ship.cargo[kind]+1e-7)bad('Cargo provenance exceeds physical stock');
    const numbered = [...globalIds, ...taskIds, ...directives.map((d) => d.id)].map((id) =>
      Number(
        id.match(
          /^(?:ship|job|facility|project|directive|orion-built|group|personnel|event|trade|site-intel|escort|admiral-task)-(\d+)$/,
        )?.[1] ?? 0,
      ),
    );
    if (numbered.some((n) => n >= w.nextId)) bad('Invalid entity sequence');
  });
