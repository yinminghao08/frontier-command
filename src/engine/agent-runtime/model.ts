import { z } from 'zod';
import { directiveSchema } from '../directive-schema';
import { actionSchema, goodsSchema, stockSchema } from '../action-schema';
import type { Action, CargoKind, CommandResult, Directive, Observation, Ship, Stock, WorldState } from '../types';

const id = z.string().min(1).max(160);
const count = z.number().finite().min(0);
const tick = count.int();
export const objectiveGoalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('operation'), action: actionSchema }).strict(),
  z.object({ kind: z.literal('loadReturn'), sourceId: id, destinationId: id, cargoKind: goodsSchema,
    deliver: z.boolean(), route: z.enum(['safe', 'direct', 'risky']) }).strict(),
  z.object({ kind: z.literal('recovery'), wreckIds: z.array(id), sourceClassId: id.nullable(),
    includeDiscoveries: z.boolean(), destinationId: id.nullable(), cargoKind: z.literal('materials') }).strict(),
  z.object({ kind: z.literal('surveyRoute'), sectors: z.array(z.object({q: z.number().int().safe(), r: z.number().int().safe()}).strict()).min(1).max(65) }).strict(),
  z.object({ kind: z.literal('construction'), siteId: id, facilityKind: z.enum(['mine','colony','outpost','platform']) }).strict(),
  z.object({ kind: z.literal('factionAssault'), factionId: z.literal('orion') }).strict(),
  z.object({ kind: z.literal('assignment'), shipId: id }).strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
]);
export type ObjectiveGoal = z.infer<typeof objectiveGoalSchema>;
export type ObjectiveKind = ObjectiveGoal['kind'];
export type GoalOf<K extends ObjectiveKind> = Extract<ObjectiveGoal, {kind: K}>;
export const taskStatusSchema = z.enum(['proposed','accepted','running','blocked','interrupted','completed','completed_partial','failed','cancelled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const terminalTask = (status: TaskStatus) => ['completed','completed_partial','failed','cancelled'].includes(status);
export const evidenceSchema = z.object({ eventId: id, tick, kind: z.enum(['directive','loaded','delivered','lost','verified']),
  sourceId: id.nullable(), targetId: id.nullable(), cargoKind: goodsSchema.nullable(), amount: count, description: z.string().max(2000) }).strict();
export type CompletionEvidence = z.infer<typeof evidenceSchema>;
export const taskSchema = z.object({
  taskId: id, objectiveId: id, ownerAgentId: id.nullable(), status: taskStatusSchema, revision: tick,
  coordinationId:id.nullable(), dependencyTaskIds:z.array(id), checkpoint: directiveSchema.nullable(), currentStep: tick, completedRevision:tick.nullable(),assignedShipIds: z.array(id), directiveIds: z.array(id), activeDirectiveId: id.nullable(),
  steps: z.array(z.object({ label: z.string().max(240), action: actionSchema, status: z.enum(['pending','running','completed','failed','cancelled']) }).strict()),
  progress: z.object({ loaded: stockSchema, delivered: stockSchema, lost: stockSchema, targetAmounts: z.record(id, count),
    targetRecovered: z.record(id, count), completedDirectives: z.array(id), cycles: tick, verified: z.boolean(), legacyUnknown: z.boolean() }).strict(),
  blockReason: z.string().max(2000).nullable(), completionEvidence: z.array(evidenceSchema), processedEventIds: z.array(id),
  createdAt: count, updatedAt: count, lastWorldKey: z.string(), submissionKeys: z.record(id, id),
}).strict();
export type TaskState = z.infer<typeof taskSchema>;
export const interactionSchema = z.object({ interactionId: id, source: z.enum(['chat','ui','collaboration','opportunity']),
  senderId: id, recipientAgentId: id.nullable(), sourceMessageId: tick.nullable(), instruction: z.string().max(2000),
  authorizationMode: z.enum(['direct','voluntary','autonomous']), objectiveId: id.nullable(),
  phase: z.enum(['received','interpreting','clarification','committed','cancelled','failed']), createdAt: count,
}).strict();
export type Interaction = z.infer<typeof interactionSchema>;
const eventBase = { eventId: id, sequence: tick, sourceId: id, objectiveId: id.nullable(), taskId: id.nullable(), directiveId: id.nullable(), simulationTick: tick };
export const domainEventSchema = z.discriminatedUnion('type', [
  z.object({...eventBase, type: z.literal('directiveOutcome'), payload: z.object({shipId: id, actorId:id, executorAgentId:id.nullable(), contractId:id.nullable(), work:count,carried:count,delivered:count,lost:count,cycle:tick,paidCredits:count,action: actionSchema, failed: z.boolean(), interrupted: z.boolean(), text: z.string().max(2000)}).strict()}).strict(),
  z.object({...eventBase, type: z.literal('cargoTransfer'), payload: z.object({ shipId: id, sourceId: id.nullable(), targetId: id.nullable(), cargoKind: goodsSchema, amount: count, disposition: z.enum(['loaded','delivered','consumed','lost']) }).strict()}).strict(),
  z.object({...eventBase,type:z.literal('objectiveRevised'),payload:z.object({revision:tick,previousGoal:objectiveGoalSchema,goal:objectiveGoalSchema,instruction:z.string().max(2000)}).strict()}).strict(),
  z.object({...eventBase, type: z.literal('taskTransition'), payload: z.object({from: taskStatusSchema, to: taskStatusSchema, reason: z.string().max(2000).nullable()}).strict()}).strict(),
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;
export const cargoLotSchema = z.object({ lotId: id, shipId: id, taskId: id.nullable(), sourceId: id.nullable(), cargoKind: goodsSchema, amount: count, acquiredTick: tick }).strict();
export type CargoLot = z.infer<typeof cargoLotSchema>;
export const replyRecordSchema = z.object({ key: id, sourceMessageId: tick, recipientAgentId: id,
  phase: z.enum(['pending','receiving','validating','committed','failed','cancelled','superseded']), primaryMessageId: tick.nullable(), revision: tick,
}).strict();
export type ReplyRecord = z.infer<typeof replyRecordSchema>;
export const runtimeSchema = z.object({ schemaVersion: z.literal(1), interactions: z.array(interactionSchema), tasks: z.array(taskSchema),
  events: z.array(domainEventSchema), cargoLots: z.array(cargoLotSchema), replies: z.array(replyRecordSchema), consumedSequence:tick,nextEvent: tick.positive(), nextLot: tick.positive() }).strict();
export type RuntimeState = z.infer<typeof runtimeSchema>;
export const emptyStock = (): Stock => ({ materials: 0, photon: 0, quantum: 0, specialFinds: 0 });
export const freshRuntime = (): RuntimeState => ({schemaVersion: 1, interactions: [], tasks: [], events: [], cargoLots: [], replies: [], consumedSequence:0,nextEvent: 1, nextLot: 1});
export interface TaskPlan { steps: TaskState['steps']; blockReason: string | null; }
export interface TaskTransition { status?: TaskStatus; evidence?: CompletionEvidence; }
export interface VerificationResult { complete: boolean; partial: boolean; reason: string; }
export interface TaskHandler<K extends ObjectiveKind> {
  validate(goal: GoalOf<K>, observation: Readonly<Observation>): CommandResult;
  plan(goal: GoalOf<K>, task: Readonly<TaskState>): TaskPlan;
  advance(task: Readonly<TaskState>, event: DomainEvent): TaskTransition;
  verifyCompletion(task: Readonly<TaskState>, world: Readonly<WorldState>): VerificationResult;
}
export interface DirectiveSubmission { ok: boolean; reason: string; directive: Directive | null; }
export interface ExecutionView { ship: Ship; directive: Directive; cargo: Stock; }
export const criterionFor = (goal: ObjectiveGoal): string => goal.kind === 'loadReturn'
  ? `actual load at ${goal.sourceId}, arrival at ${goal.destinationId}${goal.deliver ? ', attributed cargo delivered' : ', attributed cargo retained'}`
  : goal.kind === 'recovery' ? 'all enrolled Materials recovered and attributed cargo delivered; no unexplained loss'
  : goal.kind === 'operation' ? `verified authoritative ${goal.action.type} outcome`
  : `verified authoritative ${goal.kind} outcome`;

export function createTask(objective: import('../types').Objective, shipId: string|null): TaskState {
  const status: TaskStatus=objective.status==='active'?(objective.consent==='accepted'?'accepted':'proposed'):objective.status;
  return {taskId:'task:'+objective.id,objectiveId:objective.id,ownerAgentId:objective.ownerAgentId,status,revision:0,coordinationId:null,dependencyTaskIds:[],checkpoint:null,currentStep:0,
    assignedShipIds:shipId?[shipId]:[],directiveIds:[],activeDirectiveId:null,completedRevision:null,steps:[],progress:{loaded:emptyStock(),delivered:emptyStock(),lost:emptyStock(),targetAmounts:{},targetRecovered:{},completedDirectives:[],cycles:0,verified:false,legacyUnknown:false},
    blockReason:objective.reason,completionEvidence:[],processedEventIds:[],createdAt:objective.createdAt,updatedAt:objective.updatedAt,lastWorldKey:'',submissionKeys:{}};
}
