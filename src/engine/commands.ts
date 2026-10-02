import { z } from 'zod';
const id = z.string().min(1).max(160),
  n = z.number().finite(),
  count = n.int().min(1).max(10000);
export const pointSchema = z.object({ x: n, y: n }).strict();
export const stockSchema = z
  .object({
    materials: n.min(0),
    supplies: n.min(0),
    photon: n.int().min(0),
    quantum: n.int().min(0),
    specialFinds: n.int().min(0),
  })
  .strict();
export const ammoSchema = z.object({ photon: n.int().min(0), quantum: n.int().min(0) }).strict();
export const moduleSchema = z.enum([
  'deepScan',
  'longRangeSensors',
  'precisionTargeting',
  'reinforcedShields',
  'expandedCargo',
]);
export const upgradeSchema = z.enum(['shipyard', 'armory', 'sensors', 'logistics', 'defense']);
export const goodsSchema = z.enum(['materials', 'supplies', 'photon', 'quantum', 'specialFinds']);
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MOVE'), point: pointSchema }).strict(),
  z
    .object({
      type: z.literal('EXPLORE'),
      sector: z.object({ q: n.int().safe(), r: n.int().safe() }).strict(),
      approach: z.enum(['remote', 'close']),
    })
    .strict(),
  z
    .object({
      type: z.literal('SURVEY'),
      targetId: id,
      approach: z.enum(['remote', 'close']),
      deep: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('MINE'), targetId: id, unloadId: id, repeat: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('HAUL'),
      sourceId: id,
      targetId: id,
      cargoKind: goodsSchema,
      amount: count,
      route: z.enum(['safe', 'direct', 'risky']),
      repeat: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['ATTACK', 'DISABLE', 'DRIVE_OFF', 'INTERCEPT', 'SHADOW']),
      targetId: id,
      subsystem: z.enum(['engines', 'weapons']).optional(),
    })
    .strict(),
  z.object({ type: z.literal('ESCORT'), targetId: id }).strict(),
  z.object({ type: z.literal('PATROL'), targetId: id, duration: n.min(1).max(1440) }).strict(),
  z
    .object({ type: z.enum(['RETREAT', 'DOCK', 'REPAIR', 'UNLOAD', 'RECOVER']), targetId: id })
    .strict(),
  z.object({ type: z.literal('REARM'), targetId: id, load: ammoSchema }).strict(),
  z
    .object({ type: z.literal('REFIT'), targetId: id, moduleId: moduleSchema, remove: z.boolean() })
    .strict(),
]);
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('issueDirective'),
      shipIds: z
        .array(id)
        .min(1)
        .max(100)
        .refine((a) => new Set(a).size === a.length),
      mode: z.enum(['REPLACE', 'QUEUE', 'INTERRUPT']),
      action: actionSchema,
    })
    .strict(),
  z.object({ type: z.literal('cancelDirective'), shipId: id }).strict(),
  z
    .object({
      type: z.literal('standingOrders'),
      shipId: id,
      roe: z.enum(['HOLD FIRE', 'RETURN FIRE', 'ENGAGE HOSTILES']),
      retreatHull: n.min(0).max(90),
    })
    .strict(),
  z
    .object({
      type: z.literal('renameEntity'),
      entityId: id,
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal('startConstruction'),
      siteId: id,
      kind: z.enum(['mine', 'outpost', 'colony', 'platform']),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal('buildShip'),
      classId: z.enum(['antares', 'peregrine', 'constitution', 'galaxy']),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ type: z.literal('upgrade'), upgradeId: upgradeSchema }).strict(),
  z
    .object({
      type: z.literal('manufacture'),
      cargoKind: z.enum(['supplies', 'photon', 'quantum']),
      amount: count,
    })
    .strict(),
  z.object({ type: z.literal('sellStock'), cargoKind: goodsSchema, amount: count }).strict(),
  z.object({ type: z.literal('repairFacility'), locationId: id }).strict(),
  z.object({ type: z.literal('acknowledge'), communicationId: n.int().min(1) }).strict(),
  z.object({ type: z.literal('pause'), paused: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('speed'),
      speed: z.union([z.literal(1), z.literal(4), z.literal(16)]),
    })
    .strict(),
]);
