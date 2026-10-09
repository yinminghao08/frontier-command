import { z } from 'zod';
import { moduleSchema, ammoSchema } from './action-schema';
import { conditionsSchema, responseFields, activitySchema } from './condition-schema';
import { protocolSchema } from './structured-output';

const id = z.string().min(1).max(160);
const reply = z.string().trim().min(1).max(1000);
const route = z.enum(['safe', 'direct', 'risky']);
const cargo = z.enum(['materials', 'photon', 'quantum', 'specialFinds']);
const sector = z
  .object({
    q: z.number().int().min(-100000).max(100000),
    r: z.number().int().min(-100000).max(100000),
  })
  .strict();
/** Semantic goals only. Physical Actions, arbitrary predicates and entity invention
 * are excluded; the engine resolves these public references into its existing rules. */
export const objectiveProposalSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('loadReturn'),
      sourceId: id,
      destinationId: id,
      cargoKind: cargo,
      deliver: z.boolean(),
      route,
    })
    .strict(),
  z
    .object({
      kind: z.literal('supportedTransport'),
      sourceId: id,
      destinationId: id,
      cargoKind: cargo,
      amount: z.number().int().min(1).max(10000),
      route,
      escortAgentId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('transport'),
      sourceId: id,
      destinationId: id,
      cargoKind: cargo,
      amount: z.number().int().min(1).max(10000).nullable(),
      repeat: z.boolean(),
      route,
    })
    .strict(),
  z
    .object({
      kind: z.literal('recovery'),
      wreckIds: z.array(id).max(1000),
      sourceClassId: id.nullable(),
      includeDiscoveries: z.boolean(),
      destinationId: id.nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal('navigate'), targetId: id.nullable(), sector: sector.nullable() })
    .strict(),
  z.object({ kind: z.literal('survey'), targetId: id, deep: z.boolean() }).strict(),
  z.object({ kind: z.literal('explore'), sector }).strict(),
  z.object({ kind: z.literal('surveyRoute'), sectors: z.array(sector).min(1).max(65) }).strict(),
  z
    .object({ kind: z.literal('patrol'), targetId: id, duration: z.number().min(1).max(180) })
    .strict(),
  z.object({ kind: z.literal('escort'), targetShipId: id }).strict(),
  z.object({ kind: z.literal('engage'), targetIds: z.array(id).min(1).max(100) }).strict(),
  z
    .object({
      kind: z.literal('service'),
      targetId: id,
      service: z.enum(['dock', 'repair', 'retreat', 'unload', 'return']),
    })
    .strict(),
  z.object({ kind: z.literal('rearm'), locationId: id, ammunition: ammoSchema }).strict(),
  z
    .object({
      kind: z.literal('refit'),
      locationId: id,
      moduleId: moduleSchema,
      remove: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('diplomacy'),
      contactId: id,
      message: z.enum(['greeting', 'withdraw', 'deescalate']),
    })
    .strict(),
  z.object({ kind: z.literal('eventResponse'), eventId: id }).strict(),
  z.object({ kind: z.literal('secureFacility'), facilityId: id }).strict(),
  z.object({ kind: z.literal('wormholeTransit'), wormholeId: id }).strict(),
  z
    .object({
      kind: z.literal('contactOperation'),
      contactId: id,
      objective: z.enum(['disable', 'driveOff', 'intercept', 'track']),
      subsystem: z.enum(['engines', 'weapons']).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('construction'),
      siteId: id,
      facilityKind: z.enum(['mine', 'outpost', 'colony', 'platform']),
    })
    .strict(),
  z.object({ kind: z.literal('rest'), duration: z.number().min(5).max(180) }).strict(),
  z.object({ kind: z.literal('assignment'), shipId: id }).strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
  z.object({ kind: z.literal('factionAssault'), factionId: z.literal('orion') }).strict(),
]);
export type ObjectiveProposal = z.infer<typeof objectiveProposalSchema>;
export const intentDecisionSchema = z
  .object({
    disposition: z.enum(['propose', 'revise', 'clarify', 'conversation', 'continue']),
    proposal: objectiveProposalSchema.nullable(),
    objectiveId: id.nullable().default(null),
    allowWormholes: z.boolean(),
    reply,
  })
  .strict();
export const taskJudgmentSchema = z
  .object({
    response: z.enum(['accept', 'reject', 'counter']),
    reason: responseFields.reason,
    reply,
    conditions: conditionsSchema,
  })
  .strict();
export const collaborationDecisionSchema = z
  .object({
    requestId: id,
    version: z.number().int().positive(),
    response: z.enum(['accept', 'reject', 'counter']),
    reason: responseFields.reason,
    reply,
    conditions: conditionsSchema,
  })
  .strict();
export const communicationDecisionSchema = z
  .object({
    content: reply,
    purpose: z.enum(['information', 'acknowledgement']),
    social: z
      .object({
        type: z.enum(['support', 'disagree', 'mediate', 'compete', 'preference']),
        messageId: z.number().int().positive(),
        agentId: id.nullable(),
        activity: activitySchema.nullable(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export const strategicDecisionSchema = z
  .object({
    collaborationOptionId: id.nullable().optional(),
    supportAgentId: id.nullable().optional(),
    opportunityId: id.nullable(),
    riskPreference: z.enum(['cautious', 'balanced', 'bold']),
    reason: reply,
  })
  .strict();
export const cognitionSchemas = {
  intent: intentDecisionSchema,
  judgment: taskJudgmentSchema,
  collaboration: collaborationDecisionSchema,
  communication: communicationDecisionSchema,
  strategy: strategicDecisionSchema,
};
export type CognitionPurpose = keyof typeof cognitionSchemas;
export const cognitionResponseSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('intent'), decision: intentDecisionSchema }).strict(),
  z.object({ purpose: z.literal('judgment'), decision: taskJudgmentSchema }).strict(),
  z.object({ purpose: z.literal('collaboration'), decision: collaborationDecisionSchema }).strict(),
  z.object({ purpose: z.literal('communication'), decision: communicationDecisionSchema }).strict(),
  z.object({ purpose: z.literal('strategy'), decision: strategicDecisionSchema }).strict(),
]);
export type CognitionResponse = z.infer<typeof cognitionResponseSchema>;
export interface CognitionRequest {
  requestId: string;
  agentId: string;
  revision: number;
  purpose: CognitionPurpose;
  schema: Record<string, unknown>;
  context: Record<string, unknown>;
  prompt: string;
  outputBudget: number;
}
export const cognitionJsonSchema = (purpose: CognitionPurpose) =>
  protocolSchema(cognitionSchemas[purpose]);
