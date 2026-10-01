import { z } from 'zod';
import { orderSpecSchema } from './commands';
import { SHIP_CLASSES, type ShipClassId } from './definitions/ships';
import { CRITICAL_KINDS } from './types';
const n = z.number().finite(),
  nn = n.min(0),
  id = z.string().min(1).max(100),
  integer = nn.int();
const point = z.object({ x: n.min(0).max(1600), y: n.min(0).max(800) }).strict();
const ammo = z.object({ photon: integer, quantum: integer }).strict();
const stock = z.object({ supplies: nn, medical: nn, materials: nn }).strict();
const classId = z.custom<ShipClassId>(
  (x) => typeof x === 'string' && Object.hasOwn(SHIP_CLASSES, x),
);
const ship = point
  .extend({
    id,
    name: z.string(),
    classId,
    factionId: z.enum(['starfleet', 'pirate', 'romulan']),
    hull: nn,
    shield: nn,
    core: nn,
    photon: integer,
    quantum: integer,
    status: z.enum(['docked', 'mission', 'returning', 'repairing', 'rearming']),
    orderId: id.nullable(),
    targetId: id.nullable(),
    path: z.array(point).max(30),
    heading: n,
    cargo: stock,
    cooldowns: z.record(nn),
    service: nn,
    rearm: ammo,
    lastAttackerId: id.nullable(),
    attackedAt: n,
    scanUntil: nn,
    cloak: z.enum(['off', 'on', 'decloaking']),
    cloakUntil: nn,
    behavior: z.enum(['hold', 'defend', 'engage', 'retreat', 'scan', 'travel']),
  })
  .strict();
const location = point
  .extend({
    id,
    name: z.string(),
    label: z.string(),
    kind: z.enum(['base', 'colony', 'outpost', 'anomaly', 'border', 'mine', 'planet']),
    regionId: z.enum(['federation', 'neutral', 'romulan']),
    supply: nn,
    stock,
    reserved: stock,
    hull: nn,
    maxHull: nn,
    shield: nn,
    maxShield: nn,
    attackedAt: n,
    distress: z.boolean(),
    surveyed: z.boolean(),
    hazard: nn,
    surveyRevision: integer,
    rewardedRevision: integer,
  })
  .strict();
const order = orderSpecSchema
  .extend({
    id,
    created: nn,
    phase: z.enum(['preparing', 'outbound', 'decision', 'working', 'returning', 'complete']),
    work: nn,
    decisionAt: nn,
    settled: z.boolean(),
    outcome: z.enum(['success', 'failed', 'cancelled']).nullable(),
    result: z.string(),
    held: z.boolean(),
    loaded: z.boolean(),
    delivered: z.boolean(),
    reserved: nn,
    deadline: nn,
    targetLastSeen: point.nullable(),
    searchUntil: nn,
    rewarded: z.boolean(),
  })
  .strict();
export const worldSchema = z
  .object({
    version: z.literal(5),
    tick: integer,
    time: nn,
    seed: integer.max(4294967295),
    initialSeed: integer.max(4294967295),
    paused: z.boolean(),
    speed: z.union([z.literal(1), z.literal(4), z.literal(16)]),
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
    commander: z.object({ id, name: z.string(), rank: z.string() }).strict(),
    operators: z.array(
      z
        .object({
          id,
          availability: z.enum(['available', 'vesselLost']),
          kind: z.literal('rules'),
          name: z.string(),
        })
        .strict(),
    ),
    assignments: z.array(z.object({ operatorId: id, shipId: id, since: integer }).strict()),
    losses: z.array(
      z
        .object({
          shipId: id,
          name: z.string(),
          classId,
          tick: integer,
          position: point,
          reason: z.string(),
          cargo: stock,
          ammunition: ammo,
          operatorIds: z.array(id),
          orderId: id.nullable(),
        })
        .strict(),
    ),
    status: z.enum(['active', 'commandLost']),
    armory: z.object({ stock: ammo, reserved: ammo }).strict(),
    romulanReports: z.array(
      point
        .extend({
          id,
          observerId: id,
          seenAt: nn,
          confidence: nn.max(1),
          value: nn,
          defense: nn,
          kind: z.enum(['ship', 'facility']),
        })
        .strict(),
    ),
    ships: z.array(ship),
    enemies: z.array(
      ship
        .extend({
          home: point,
          destination: point.nullable(),
          departed: z.boolean(),
          visited: z.array(z.object({ id, time: nn }).strict()),
          intent: z.enum(['observe', 'raid', 'probe', 'retreat']),
          nextDecision: nn,
          loot: nn,
          knownTargets: z.array(point.extend({ id, seenAt: nn, score: n }).strict()),
        })
        .strict(),
    ),
    intel: z.array(
      point
        .extend({
          id,
          level: z.enum(['UNKNOWN', 'CONTACT', 'CLASSIFIED', 'IDENTIFIED', 'TRACKED']),
          strength: nn.max(12),
          lastSeen: nn,
          live: z.boolean(),
          name: z.string().optional(),
          factionId: z.enum(['starfleet', 'pirate', 'romulan']).optional(),
          classId: classId.optional(),
          hull: nn.optional(),
          shield: nn.optional(),
          lastAttackTargetId: id.optional(),
          lastAttackAt: nn.optional(),
          hostile: z.boolean(),
          resolved: z.boolean(),
          resolution: z.enum(['destroyed', 'withdrawn']).optional(),
        })
        .strict(),
    ),
    orders: z.array(order),
    locations: z.array(location),
    resources: z.object({ science: nn, intel: nn, allocation: nn }).strict(),
    communications: z
      .array(
        z
          .object({
            id: integer,
            time: nn,
            priority: z.enum(['normal', 'high', 'urgent']),
            text: z.string(),
            read: z.boolean(),
            entityId: id.nullable(),
            category: z.enum(['request', 'report', 'threat', 'decision']),
          })
          .strict(),
      )
      .max(100),
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
    beams: z.array(
      z
        .object({ from: point, to: point, enemy: z.boolean(), weapon: z.string(), expires: nn })
        .strict(),
    ),
    nextLog: integer,
    nextComms: integer,
    nextOrder: integer,
    nextEnemy: integer,
    nextIncursion: nn,
    explored: z.array(point.extend({ time: nn }).strict()),
  })
  .strict()
  .superRefine((w, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (Math.abs(w.time - w.tick / 10) > 1e-8) bad('Clock mismatch');
    for (const entries of [w.ships, w.enemies, w.orders, w.locations, w.operators, w.intel])
      if (new Set(entries.map((x) => x.id)).size !== entries.length) bad('Duplicate identifiers');
    if (!w.locations.some((l) => l.id === 'base' && l.kind === 'base')) bad('Missing base');
    const activeIds = new Set(w.ships.map((s) => s.id));
    if (
      new Set(w.losses.map((l) => l.shipId)).size !== w.losses.length ||
      w.losses.some((l) => activeIds.has(l.shipId))
    )
      bad('Invalid loss archive');
    if (
      new Set(w.assignments.map((a) => a.shipId)).size !== w.assignments.length ||
      new Set(w.assignments.map((a) => a.operatorId)).size !== w.assignments.length
    )
      bad('Duplicate assignments');
    for (const a of w.assignments)
      if (
        !activeIds.has(a.shipId) ||
        !w.operators.some((o) => o.id === a.operatorId && o.availability === 'available')
      )
        bad('Invalid operator assignment');
    for (const k of ['photon', 'quantum'] as const) {
      if (
        w.armory.reserved[k] > w.armory.stock[k] ||
        w.armory.reserved[k] !== w.ships.reduce((sum, s) => sum + s.rearm[k], 0)
      )
        bad('Invalid armory reservation');
    }
    const base = w.locations.find((l) => l.id === 'base');
    if ((w.status === 'commandLost') !== (base?.hull === 0)) bad('Invalid command status');
    if (w.ships.some((s) => s.hull <= 0)) bad('Destroyed ship in active fleet');
    for (const s of [...w.ships, ...w.enemies]) {
      const d = SHIP_CLASSES[s.classId];
      if (!d) {
        bad('Unknown ship class');
        continue;
      }
      if (
        s.hull > d.hull + 0.0001 ||
        s.shield > d.shield + 0.0001 ||
        s.core > d.core + 0.0001 ||
        s.photon > d.photon ||
        s.quantum > d.quantum
      )
        bad('Ship attributes exceed class limits');
      if (Object.values(s.cargo).reduce((a, b) => a + b, 0) > d.cargo)
        bad('Cargo capacity exceeded');
      if (s.rearm.photon + s.photon > d.photon || s.rearm.quantum + s.quantum > d.quantum)
        bad('Reserved ammunition exceeds capacity');
      if (s.orderId && !w.orders.some((o) => o.id === s.orderId)) bad('Dangling order');
    }
    for (const o of w.orders) {
      if (
        o.shipIds.some(
          (id) => !w.ships.some((s) => s.id === id) && !w.losses.some((l) => l.shipId === id),
        )
      )
        bad('Missing order ship');
      if (
        o.settled !== (o.outcome !== null) ||
        ((o.phase === 'returning' || o.phase === 'complete') && !o.settled)
      )
        bad('Invalid settlement');
      if (
        o.objective.type === 'location' &&
        !w.locations.some((l) => o.objective.type === 'location' && l.id === o.objective.id)
      )
        bad('Missing objective');
    }
    for (const l of w.locations)
      for (const k of ['supplies', 'medical', 'materials'] as const) {
        const reserved = w.orders
          .filter((o) => o.sourceId === l.id && o.cargoKind === k)
          .reduce((sum, o) => sum + o.reserved, 0);
        if (Math.abs(l.reserved[k] - reserved) > 1e-6 || l.reserved[k] > l.stock[k])
          bad('Invalid inventory reservation');
      }
  });
