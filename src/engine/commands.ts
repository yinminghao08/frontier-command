import { z } from 'zod';
const id = z.string().min(1).max(80);
const ship = { shipId: id };
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('dispatch'),
      ...ship,
      missionId: id,
      route: z.enum(['safe', 'fast']),
    })
    .strict(),
  z.object({ type: z.literal('route'), ...ship, route: z.enum(['safe', 'fast']) }).strict(),
  z
    .object({ type: z.literal('investigate'), ...ship, choice: z.enum(['remote', 'close']) })
    .strict(),
  ...(['recall', 'scan', 'repair', 'takeControl', 'fire', 'hold', 'resume'] as const).map((type) =>
    z.object({ type: z.literal(type), ...ship }).strict(),
  ),
  ...(['hail', 'engage', 'target'] as const).map((type) =>
    z.object({ type: z.literal(type), ...ship, targetId: id }).strict(),
  ),
  z.object({ type: z.literal('releaseControl'), ...ship, resume: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('helm'),
      ...ship,
      turn: z.number().finite().min(-1).max(1),
      throttle: z.number().finite().min(-1).max(1),
    })
    .strict(),
  z.object({ type: z.literal('pause'), paused: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('speed'),
      speed: z.union([z.literal(1), z.literal(4), z.literal(16)]),
    })
    .strict(),
  z.object({ type: z.literal('renew'), missionId: id }).strict(),
]);
