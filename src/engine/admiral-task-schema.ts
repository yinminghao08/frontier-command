import { z } from 'zod';
import { actionSchema } from './commands';
const id = z.string().min(1).max(160),
  n = z.number().finite(),
  integer = n.int().min(0);
export const admiralTaskSchema = z
  .object({
    id,
    agentId: id,
    messageId: integer.positive(),
    channelId: id,
    kind: z.enum(['action', 'assign', 'construction', 'surveyRoute', 'cancel']),
    status: z.enum(['active', 'blocked', 'completed', 'cancelled']),
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
  })
  .strict();
