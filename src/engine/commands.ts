import { cognitionResponseSchema } from './cognition-protocol';
import { objectiveGoalSchema } from './agent-runtime/model';
import { z } from 'zod';
import { agentCareerSchema, modelConfigSchema } from './agent-schema';
import { activitySchema, conditionsSchema, responseFields } from './condition-schema';
import {
  actionSchema,
  pointSchema,
  stockSchema,
  ammoSchema,
  moduleSchema,
  upgradeSchema,
  goodsSchema,
} from './action-schema';
export {
  actionSchema,
  pointSchema,
  stockSchema,
  ammoSchema,
  moduleSchema,
  upgradeSchema,
  goodsSchema,
} from './action-schema';
const id = z.string().min(1).max(160),
  n = z.number().finite(),
  count = n.int().min(1).max(10000);
export const careerSchema = z.enum([
  'battle',
  'science',
  'diplomacy',
  'logistics',
  'security',
  'commander',
]);
export const standingSchema = z
  .object({
    roe: z.enum(['HOLD FIRE', 'RETURN FIRE', 'ENGAGE HOSTILES']),
    retreatHull: n.min(0).max(90),
    retreatShield: n.min(0).max(90),
    retreatCore: n.min(0).max(90),
    photonThreshold: n.min(0).max(100),
    quantumThreshold: n.min(0).max(100),
    maxPursuit: n.min(0).max(2000),
    allowNeutral: z.boolean(),
    allowRomulan: z.boolean(),
    autoEscort: z.boolean(),
    respondDistress: z.boolean(),
    protectCivilian: z.boolean(),
    protectFreighter: z.boolean(),
    protectColony: z.boolean(),
    serviceWhenDocked: z.boolean(),
  })
  .strict();
const members = z
  .array(id)
  .min(1)
  .max(100)
  .refine((a) => new Set(a).size === a.length);
const groupFields = {
  name: z.string().trim().min(1).max(80),
  shipIds: members,
  flagshipId: id,
  spacing: n.min(15).max(100),
};
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('cognitionDecision'),
      agentId: id,
      requestId: id,
      response: cognitionResponseSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('respondPiracy'),
      incidentId: id,
      shipId: id,
      response: z.enum(['comply', 'refuse']),
    })
    .strict(),
  z
    .object({
      type: z.literal('setPiracyPolicy'),
      shipId: id,
      policy: z.enum(['preserveShip', 'preserveCargo', 'manual']),
    })
    .strict(),
  z
    .object({ type: z.literal('interpretInteraction'), agentId: id, messageId: n.int().positive() })
    .strict(),
  z.object({ type: z.literal('assignAgent'), agentId: id, shipId: id.nullable() }).strict(),
  z
    .object({
      type: z.literal('configureAgent'),
      agentId: id,
      modelConfig: modelConfigSchema,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('retryAgent'),
      agentId: id,
      messageId: n.int().positive().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('cancelAgentReply'), agentId: id, messageId: n.int().positive() })
    .strict(),
  z
    .object({
      type: z.literal('proposeDirective'),
      shipIds: members,
      mode: z.enum(['REPLACE', 'QUEUE', 'INTERRUPT']),
      action: actionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('sendChat'),
      channelId: id,
      content: z.string().trim().min(1).max(1200),
      mentions: z.array(id).max(12),
      controlMode: z.enum(['voluntary', 'direct']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('resolveProposal'),
      contractId: id,
      version: n.int().positive(),
      response: z.enum(['approve', 'reject', 'cancel', 'takeover']),
    })
    .strict(),
  z.object({ type: z.literal('readChat'), channelId: id, throughId: n.int().min(0) }).strict(),
  z
    .object({
      type: z.literal('agentDecisionState'),
      agentId: id,
      revision: n.int().min(0),
      state: z.enum(['waiting', 'receiving', 'validating', 'error', 'offline', 'ready']),
      error: z.string().max(400).nullable(),
    })
    .strict(),
  z.object({ type: z.literal('dismissMapMarker'), entityId: id }).strict(),
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
  z
    .object({
      type: z.literal('submitObjective'),
      shipId: id,
      goal: objectiveGoalSchema,
      authorizationMode: z.enum(['direct', 'voluntary']),
      instruction: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('cancelObjective'),
      objectiveId: id,
      expectedRevision: n.int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('resumeObjective'),
      objectiveId: id,
      expectedRevision: n.int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('reviseObjective'),
      objectiveId: id,
      expectedRevision: n.int().min(0),
      goal: objectiveGoalSchema,
      instruction: z.string().min(1).max(2000),
    })
    .strict(),
  z.object({ type: z.literal('cancelDirective'), shipId: id }).strict(),
  z.object({ type: z.literal('modifyCurrentTask'), shipId: id, action: actionSchema }).strict(),
  z.object({ type: z.literal('standingOrders'), shipId: id, orders: standingSchema }).strict(),
  z.object({ type: z.literal('setCloak'), shipId: id, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('createGroup'), ...groupFields }).strict(),
  z.object({ type: z.literal('updateGroup'), groupId: id, ...groupFields }).strict(),
  z.object({ type: z.literal('deleteGroup'), groupId: id }).strict(),
  z
    .object({
      type: z.literal('issueGroupDirective'),
      groupId: id,
      mode: z.enum(['REPLACE', 'QUEUE', 'INTERRUPT']),
      action: actionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('candidate'),
      personnelId: id,
      accept: z.boolean(),
      career: agentCareerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('assignPersonnel'),
      personnelId: id,
      targetId: id,
      targetType: z.enum(['ship', 'colony']),
    })
    .strict(),
  z
    .object({
      type: z.literal('developColony'),
      locationId: id,
      kind: z.enum(['housing', 'industry', 'science', 'security']),
    })
    .strict(),
  z
    .object({
      type: z.literal('respondEvent'),
      eventId: id,
      choice: z.enum([
        'assist',
        'quarantine',
        'liftQuarantine',
        'accept',
        'reject',
        'withdraw',
        'stabilize',
      ]),
      targetId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('tradeStock'),
      direction: z.enum(['buy', 'sell']),
      cargoKind: goodsSchema,
      amount: count,
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
      locationId: id.optional(),
      classId: z.enum(['antares', 'peregrine', 'constitution', 'galaxy']),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({ type: z.literal('upgrade'), upgradeId: upgradeSchema, locationId: id.optional() })
    .strict(),
  z
    .object({
      type: z.literal('manufacture'),
      locationId: id.optional(),
      cargoKind: z.enum(['photon', 'quantum']),
      amount: count,
    })
    .strict(),
  z
    .object({
      type: z.literal('startBaseRefit'),
      locationId: id,
      name: z.string().trim().min(1).max(80),
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
