import { z } from 'zod';
import { actionSchema, pointSchema, stockSchema } from './action-schema';
const n = z.number().finite(),
  nn = n.min(0),
  integer = nn.int(),
  id = z.string().min(1).max(160);
const journeyLeg = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('warp'),
      destination: pointSchema,
      route: z.enum(['safe', 'direct', 'risky']),
      path: z.array(pointSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal('wormhole'),
      wormholeId: id,
      entrance: pointSchema,
      destination: pointSchema,
    })
    .strict(),
]);
const journey = z
  .object({
    destination: pointSchema,
    legs: z.array(journeyLeg).max(100),
    eta: nn,
    risk: nn.max(100),
    score: nn,
    distance: nn,
    unknownDistance: nn,
    legIndex: integer,
    transitWork: nn.max(2.1),
  })
  .strict();
export const directiveSchema = z
  .object({
    id,
    originInteractionId: id.optional(),
    objectiveId: id.optional(),
    submissionKey: id.optional(),
    action: actionSchema,
    created: nn,
    phase: z.enum([
      'starting',
      'following',
      'unloading',
      'loading',
      'delivering',
      'refitting',
      'rearming',
      'reserved',
      'capturing',
    ]),
    work: nn,
    moved: nn,
    carried: nn,
    delivered: nn,
    lost: nn.optional(),
    reserved: stockSchema,
    paidCredits: nn,
    search: nn,
    note: z.string(),
    source: z.enum(['admiral', 'agent', 'standing']),
    actorId: id,
    executorAgentId: id.nullable(),
    sourceMessageId: integer.positive().nullable(),
    taskId: id.nullable(),
    contractId: id.nullable(),
    cycle: integer,
    controlMode: z.enum(['direct', 'voluntary', 'autonomous']),
    allowWormholes: z.boolean(),
    journey: journey.nullable(),
    groupOrderId: id.nullable(),
    groupSlot: integer,
    groupTotal: n.min(0),
    groupSpacing: nn,
    origin: pointSchema,
    targetIndex: integer.optional(),
    unconfirmedTargets: z.array(id).max(100).optional(),
  })
  .strict();
