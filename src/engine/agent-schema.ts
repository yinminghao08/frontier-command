import { z } from 'zod';
import { activitySchema, conditionsSchema } from './condition-schema';
import { actionSchema } from './action-schema';
import { freshAgentDynamics } from './definitions/agents';
export const agentDynamicsSchema = z
  .object({
    activity: z.enum(['work', 'combat', 'idle', 'docked', 'rest']),
    fatigueRate: z.number().finite(),
    stressRate: z.number().finite(),
    resentmentRate: z.number().finite(),
    engagementTick: z.number().int().min(0).nullable(),
    lastDangerAt: z.number().finite().min(0),
    hullBands: z.array(z.number()).max(3),
    thresholds: z.array(z.string()).max(4),
    recent: z
      .array(
        z
          .object({
            id: z.string().max(160),
            time: z.number().min(0),
            cause: z.string().max(240),
            changes: z
              .object({
                fatigue: z.number().optional(),
                stress: z.number().optional(),
                resentment: z.number().optional(),
                confidence: z.number().optional(),
                morale: z.number().optional(),
                trust: z.number().optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const agentCareerSchema = z.enum(['battle', 'logistics']);
export const reasoningSchema = z.enum(['provider-default','none','minimal','low','medium','high','xhigh','max']);
const id = z.string().min(1).max(160),
  n = z.number().finite().min(0),
  percent = n.max(100);
export const modelConfigSchema = z
  .object({
    model: z.string().trim().min(1).max(120).nullable(),
    reasoningEffort: reasoningSchema.nullable(),
    thinking: z.enum(['provider-default','on','off']).nullable().default(null),
  })
  .strict();
export const agentSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    career: agentCareerSchema,
    personality: z
      .object({
        riskTolerance: percent,
        cooperation: percent,
        discipline: percent,
        ambition: percent,
      })
      .strict(),
    profile: z
      .object({
        patience: percent,
        assertiveness: percent,
        sociability: percent,
        motivations: z
          .object({
            safety: percent,
            duty: percent,
            profit: percent,
            growth: percent,
            belonging: percent,
          })
          .strict(),
        style: z.enum(['concise', 'warm', 'formal', 'direct']),
      })
      .strict(),
    psychology: z.object({ stress: percent, confidence: percent, resentment: percent }).strict(),
    longTermGoal: z
      .object({ activity: activitySchema, summary: z.string().min(1).max(240) })
      .strict(),
    taskPreferences: z
      .object({ security: percent, logistics: percent, exploration: percent, growth: percent })
      .strict(),
    rewardCredits: n,
    feedbackEvents: z.array(id),
    stateDynamics: agentDynamicsSchema.default(freshAgentDynamics),
    skills: z.object({ battle: percent, logistics: percent, navigation: percent }).strict(),
    experience: n,
    trust: percent,
    fatigue: percent,
    morale: percent,
    currentGoal: z.string().max(240),
    memory: z
      .array(
        z
          .object({
            id: n.int(),
            time: n,
            kind: z.enum(['chat', 'decision', 'outcome', 'danger']),
            summary: z.string().max(400),
            entityId: id.nullable(),
            salience: n.max(10),
          })
          .strict(),
      )
      .max(32),
    relationships: z.record(
      id,
      z.object({ trust: percent, cooperation: percent, lastInteraction: n }).strict(),
    ),
    originPersonnelId: id.nullable(),
    modelConfig: modelConfigSchema,
    enabled: z.boolean(),
    status: z.enum(['online', 'waiting', 'executing', 'error', 'unassigned', 'admiral', 'offline']),
    decision: z
      .object({
        revision: n.int(),
        pendingReasons: z.array(z.string().max(100)).max(8),
        nextAt: n,
        lastAt: n.nullable(),
        lastChatId: n.int(),
        lastAdmiralMessageId: n.int(),
        failures: n.int(),
        lastError: z.string().max(400).nullable(),
        contextKey: z.string().max(20000),
        dangerKey: z.string().max(500),
        events: z
          .array(
            z
              .object({
                id,
                kind: z.enum([
                  'chat',
                  'request',
                  'danger',
                  'state',
                  'opportunity',
                  'manual',
                  'configuration',
                  'recovery',
                ]),
                time: n,
              })
              .strict(),
          )
          .max(8),
      })
      .strict(),
  })
  .strict();
export const chatChannelSchema = z
  .object({
    id,
    name: id,
    kind: z.enum(['command', 'private', 'reports']),
    members: z.array(id),
    readThrough: n.int(),
  })
  .strict();
export const chatMessageSchema = z
  .object({
    id: n.int().positive(),
    sender: id,
    channelId: id,
    time: n,
    content: z.string().trim().min(1).max(2000),
    mentions: z.array(id).max(12),
    kind: z.enum(['message', 'request', 'reply', 'report', 'danger', 'error']),
    purpose: z.enum(['information', 'acknowledgement', 'request']).default('information'),
    replyTo: n.int().positive().nullable().default(null),
    origin: z.enum(['admiral', 'agent', 'engine', 'legacy']).default('legacy'),
    eventId: id.nullable().default(null),
    requestId: id.nullable().default(null),
    controlMode: z.enum(['voluntary', 'direct']).default('voluntary'),
    responses: z
      .record(id, z.enum(['pending', 'replied', 'failed', 'superseded', 'cancelled']))
      .optional(),
  })
  .strict();
export const escortRequestSchema = z
  .object({
    id,
    requesterId: id,
    responderId: id,
    targetShipId: id,
    created: n,
    deadline: n,
    started: z.boolean(),
    executionStarted: z.boolean(),
    rescueArrivedAt: z.number().finite().min(0).optional(),
    status: z.enum([
      'pending',
      'negotiating',
      'awaitingApproval',
      'accepted',
      'rejected',
      'completed',
      'failed',
      'cancelled',
    ]),
    kind: z.enum(['escort', 'team', 'reinforce', 'logistics', 'handoff']),
    action: z.lazy(() => actionSchema).nullable(),
    followUp: z.lazy(() => actionSchema).nullable(),
    parentTaskId: id.nullable(),
    conditions: conditionsSchema,
    conditionVersion: n.int().positive(),
    rounds: n.int().max(2),
    turnAgentId: id,
    creditsApproved: z.boolean(),
    explicitDeadline: z.boolean(),
    reason: z.string().max(600).nullable(),
  })
  .strict();
