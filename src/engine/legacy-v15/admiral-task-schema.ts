import { z } from 'zod';
import { actionSchema } from './commands';
import { conditionsSchema } from './condition-schema';
const id = z.string().min(1).max(160),
  n = z.number().finite(),
  integer = n.int().min(0);
export const admiralTaskSchema = z
  .object({
    id,
    agentId: id,
    messageId: integer.positive(),
    channelId: id,
    kind: z.enum(['action', 'assign', 'construction', 'surveyRoute', 'cancel', 'factionAssault', 'salvage']),
    salvage: z.object({ wreckIds: z.array(id).min(1).max(1000), destinationId: id.nullable() }).strict().optional(),
    factionId: z.literal('orion').optional(),
    searchedTargets: z.record(id, n.min(0)).optional(),
    directiveMode: z.enum(['REPLACE', 'QUEUE', 'INTERRUPT']).optional(),
    status: z.enum(['active', 'blocked', 'completed', 'cancelled', 'failed']),
    action: actionSchema.nullable(),
    targetId: id.nullable(),
    shipId: id.nullable(),
    facilityKind: z.enum(['mine', 'colony', 'outpost', 'platform']).nullable(),
    sectors: z.array(z.object({ q: n.int().safe(), r: n.int().safe() }).strict()).max(65),
    sectorIndex: integer.max(65),
    scannedSectorIndices: z.array(integer.max(64)).max(65),
    allowWormholes: z.boolean(),
    projectId: id.nullable(),
    carrierAgentId: id.nullable(),
    reason: z.string().max(2000).nullable(),
    controlMode: z.enum(['voluntary', 'direct']),
    consent: z.enum(['proposed', 'accepted', 'rejected', 'negotiating', 'withdrawn']),
    conditions: conditionsSchema,
    conditionVersion: integer.positive(),
    rounds: integer.max(2),
    turnAgentId: id,
    creditsApproved: z.boolean(),
  })
  .strict();