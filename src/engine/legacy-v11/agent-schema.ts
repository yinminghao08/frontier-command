import { z } from 'zod';
export const agentCareerSchema = z.enum(['battle', 'logistics']);
export const reasoningSchema = z.enum(['none', 'low', 'medium', 'high']);
const id = z.string().min(1).max(160),
  n = z.number().finite().min(0),
  percent = n.max(100);
export const modelConfigSchema = z
  .object({
    model: z.string().trim().min(1).max(120).nullable(),
    reasoningEffort: reasoningSchema.nullable(),
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
    assignedShipId: id.nullable(),
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
        failures: n.int(),
        lastError: z.string().max(400).nullable(),
      })
      .strict(),
  })
  .strict();
export const chatChannelSchema = z
  .object({
    id,
    name: id,
    kind: z.enum(['command', 'private']),
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
    status: z.enum(['pending', 'accepted', 'rejected', 'completed', 'failed']),
  })
  .strict();
