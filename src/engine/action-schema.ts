import { z } from 'zod';

const id = z.string().min(1).max(160),
  n = z.number().finite(),
  count = n.int().min(1).max(10000);
export const pointSchema = z.object({ x: n, y: n }).strict();
export const stockSchema = z
  .object({
    materials: n.min(0),

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
export const goodsSchema = z.enum(['materials', 'photon', 'quantum', 'specialFinds']);
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
  z.object({ type: z.literal('RETURN') }).strict(),
  z
    .object({
      type: z.literal('LOAD'),
      sourceId: id,
      cargoKind: goodsSchema,
      route: z.enum(['safe', 'direct', 'risky']),
    })
    .strict(),
  z.object({ type: z.enum(['ASSIST_EVENT', 'TRANSIT', 'CAPTURE']), targetId: id }).strict(),
  z
    .object({
      type: z.literal('HAIL'),
      targetId: id,
      message: z.enum(['greeting', 'withdraw', 'deescalate']),
    })
    .strict(),
  z
    .object({
      type: z.literal('HAUL'),
      sourceId: id,
      targetId: id,
      cargoKind: goodsSchema,
      amount: count,
      route: z.enum(['safe', 'direct', 'risky']),
      repeat: z.boolean(),
      loadPolicy: z.enum(['auto', 'fixed']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['ATTACK', 'DISABLE', 'DRIVE_OFF', 'INTERCEPT', 'SHADOW']),
      targetId: id,
      subsystem: z.enum(['engines', 'weapons']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('ATTACK_SET'),
      targetIds: z
        .array(id)
        .min(1)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .strict(),
  z.object({ type: z.literal('ESCORT'), targetId: id }).strict(),
  z.object({ type: z.literal('PATROL'), targetId: id, duration: n.min(1).max(1440) }).strict(),
  z.object({ type: z.literal('REST'), targetId: id, duration: n.min(1).max(1440) }).strict(),
  z
    .object({ type: z.enum(['RETREAT', 'DOCK', 'REPAIR', 'UNLOAD', 'RECOVER']), targetId: id })
    .strict(),
  z.object({ type: z.literal('REARM'), targetId: id, load: ammoSchema }).strict(),
  z
    .object({ type: z.literal('REFIT'), targetId: id, moduleId: moduleSchema, remove: z.boolean() })
    .strict(),
]);
