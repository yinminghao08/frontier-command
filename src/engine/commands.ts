import { z } from 'zod';
const id = z.string().min(1).max(80);
const percent = z.number().finite().min(0).max(90);
export const objectiveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('location'), id }).strict(),
  z.object({ type: z.literal('ship'), id }).strict(),
  z.object({ type: z.literal('contact'), id }).strict(),
  z
    .object({
      type: z.literal('point'),
      x: z.number().finite().min(20).max(1580),
      y: z.number().finite().min(20).max(780),
    })
    .strict(),
]);
export const orderSpecSchema = z
  .object({
    kind: z.enum(['defense', 'transport', 'explore']),
    objective: objectiveSchema,
    shipIds: z
      .array(id)
      .min(1)
      .max(4)
      .refine((a) => new Set(a).size === a.length),
    priority: z.enum(['normal', 'high', 'urgent']),
    roe: z.enum(['HOLD FIRE', 'RETURN FIRE', 'ENGAGE HOSTILES', 'WEAPONS FREE']),
    border: z.enum(['federation', 'neutral', 'romulan']),
    retreat: z
      .object({ hull: percent, shield: percent, core: percent, emptyAmmo: z.boolean() })
      .strict(),
    duration: z.number().finite().min(10).max(180),
    sourceId: id,
    cargoKind: z.enum(['supplies', 'medical', 'materials']),
    amount: z.number().int().min(1).max(100),
    route: z.enum(['safe', 'fast']),
    approach: z.enum(['remote', 'close']),
  })
  .strict();
export const changesSchema = orderSpecSchema
  .pick({
    priority: true,
    roe: true,
    retreat: true,
    border: true,
    route: true,
    approach: true,
    objective: true,
    shipIds: true,
  })
  .partial()
  .strict();
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createOrder'), spec: orderSpecSchema }).strict(),
  z.object({ type: z.literal('updateOrder'), orderId: id, changes: changesSchema }).strict(),
  ...(['cancelOrder', 'holdOrder', 'resumeOrder'] as const).map((type) =>
    z.object({ type: z.literal(type), orderId: id }).strict(),
  ),
  z
    .object({ type: z.literal('investigate'), orderId: id, approach: z.enum(['remote', 'close']) })
    .strict(),
  ...(['scan', 'recall', 'repair', 'rearm'] as const).map((type) =>
    z.object({ type: z.literal(type), shipId: id }).strict(),
  ),
  z
    .object({ type: z.literal('acknowledge'), communicationId: z.number().int().positive() })
    .strict(),
  z.object({ type: z.literal('pause'), paused: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('speed'),
      speed: z.union([z.literal(1), z.literal(4), z.literal(16)]),
    })
    .strict(),
]);
