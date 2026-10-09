import { z } from 'zod';
const id = z.string().min(1).max(160),
  percent = z.number().finite().min(1).max(100);
export const activitySchema = z.enum(['security', 'logistics', 'exploration', 'growth']);
export const conditionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('repair'),
      when: z.enum(['before', 'after']),
      locationId: id,
      hullPercent: percent,
    })
    .strict(),
  z
    .object({
      type: z.literal('rest'),
      when: z.enum(['before', 'after']),
      locationId: id,
      minutes: z.number().finite().min(1).max(1440),
    })
    .strict(),
  z
    .object({
      type: z.literal('reward'),
      when: z.literal('after'),
      credits: z.number().int().min(1).max(10000),
    })
    .strict(),
  z.object({ type: z.literal('escort'), when: z.literal('before'), agentId: id }).strict(),
]);
export const conditionsSchema = z.array(conditionSchema).max(4);
export const conditionHistorySchema = z
  .array(
    z
      .object({
        version: z.number().int().positive(),
        previousConditions: conditionsSchema,
        conditions: conditionsSchema,
      })
      .strict(),
  )
  .default([]);
export function conditionGenerationFloor(
  history: readonly {
    version: number;
    previousConditions: readonly import('./types').TaskCondition[];
    conditions: readonly import('./types').TaskCondition[];
  }[],
  condition: import('./types').TaskCondition,
): number {
  return Math.max(
    0,
    ...history
      .filter(
        (h) =>
          JSON.stringify(h.previousConditions.find((c) => c.type === condition.type) ?? null) !==
          JSON.stringify(h.conditions.find((c) => c.type === condition.type) ?? null),
      )
      .map((h) => h.version),
  );
}
export const responseFields = {
  version: z.number().int().positive(),
  response: z.enum(['accept', 'reject', 'counter', 'withdraw']),
  conditions: conditionsSchema,
  reason: z.enum([
    'risk',
    'fatigue',
    'damage',
    'conflict',
    'preference',
    'relationship',
    'promise',
  ]),
};
export const commitmentSchema = z
  .object({
    id,
    contractId: id,
    agentId: id,
    condition: conditionSchema,
    conditionVersion: z.number().int().positive().default(1),
    status: z.enum(['pending', 'fulfilled', 'broken', 'refunded']),
    escrow: z.number().finite().min(0),
    directiveId: id.nullable(),
  })
  .strict();
