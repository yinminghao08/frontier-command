import { z } from 'zod';
import { directiveSchema } from '../directive-schema';
import { actionSchema, goodsSchema, stockSchema } from '../action-schema';
import type { Action, CargoKind, CommandResult, Directive, Observation, Ship, Stock, WorldState,ReadonlyDeep } from '../types';

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
export const TASK_TRANSITIONS:Readonly<Record<TaskStatus,readonly TaskStatus[]>>={
  proposed:['accepted','blocked','interrupted','failed','cancelled'],
  accepted:['running','blocked','interrupted','proposed','completed','completed_partial','failed','cancelled'],
  running:['blocked','interrupted','accepted','proposed','completed','completed_partial','failed','cancelled'],
  blocked:['running','accepted','interrupted','proposed','completed','completed_partial','failed','cancelled'],
  interrupted:['accepted','proposed','failed','cancelled'],
  completed:[],completed_partial:[],failed:[],cancelled:[],
};
export const terminalTask = (status: TaskStatus) => ['completed','completed_partial','failed','cancelled'].includes(status);
export const evidenceSchema = z.object({ eventId: id, tick, kind: z.enum(['directive','loaded','delivered','lost','verified']),
  sourceId: id.nullable(), targetId: id.nullable(), cargoKind: goodsSchema.nullable(), amount: count, description: z.string().max(2000) }).strict();
export type CompletionEvidence = z.infer<typeof evidenceSchema>;
export const dependencySchema=z.object({taskId:id,criterion:z.enum(['completed','rendezvous']),targetShipId:id.nullable(),status:z.enum(['pending','fulfilled']),evidenceEventId:id.nullable()}).strict();
export type TaskDependency=z.infer<typeof dependencySchema>;
export const executionSchema=z.object({sectorIndex:tick.max(65),scannedSectorIndices:z.array(tick.max(64)).max(65),projectId:id.nullable(),carrierAgentId:id.nullable(),selectedTargetId:id.nullable(),searchedTargets:z.record(id,count)}).strict();
export type TaskExecution=z.infer<typeof executionSchema>;
export const taskSchema = z.object({
  taskId: id, objectiveId: id, ownerAgentId: id.nullable(), status: taskStatusSchema,scheduling:z.enum(['queued','active','idle']).default('idle'), revision: tick,
  coordinationId:id.nullable(), dependencyTaskIds:z.array(id), dependencies:z.array(dependencySchema).default([]),checkpoint: directiveSchema.nullable(), currentStep: tick, completedRevision:tick.nullable(),assignedShipIds: z.array(id), directiveIds: z.array(id), activeDirectiveId: id.nullable(),
  steps: z.array(z.object({ label: z.string().max(240), action: actionSchema, status: z.enum(['pending','running','completed','failed','cancelled']) }).strict()),
  execution:executionSchema,
  scope:z.object({revision:tick,loadedBaseline:stockSchema,deliveredBaseline:stockSchema,lostBaseline:stockSchema,divertedBaseline:stockSchema.default(()=>emptyStock()),carryIn:stockSchema}).strict(),
  progress: z.object({ loaded: stockSchema, delivered: stockSchema, lost: stockSchema, diverted:stockSchema.default(()=>emptyStock()), targetAmounts: z.record(id, count),
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
  z.object({...eventBase,type:z.literal('directiveProgress'),payload:z.object({phase:id,text:z.string().max(2000)}).strict()}).strict(),
  z.object({...eventBase,type:z.literal('taskDependency'),payload:z.object({childTaskId:id,criterion:z.enum(['completed','rendezvous']),targetShipId:id.nullable()}).strict()}).strict(),
  z.object({...eventBase,type:z.literal('directiveCycle'),payload:z.object({shipId:id,cycle:tick,carried:count,delivered:count,lost:count}).strict()}).strict(),
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
export interface TaskView {world:ReadonlyDeep<WorldState>;objective:ReadonlyDeep<import('../types').Objective>;ship:ReadonlyDeep<Ship>|null;}
export interface TaskPlan {
  action?:Action;shipId?:string;command?:Extract<import('../types').Command,{type:'assignAgent'|'cancelDirective'|'startConstruction'}>;
  request?:{agentId:string;kind:'logistics';action:Action};
  execution?:TaskExecution;status?:TaskStatus;reason?:string;
}
export interface TaskTransition { execution?:TaskExecution; }
export interface VerificationResult { complete: boolean; partial: boolean; reason: string; }
export interface TaskHandler<K extends ObjectiveKind> {
  validate(goal:ReadonlyDeep<GoalOf<K>>,view:TaskView):CommandResult;
  plan(goal:ReadonlyDeep<GoalOf<K>>,task:ReadonlyDeep<TaskState>,view:TaskView):TaskPlan;
  advance(goal:ReadonlyDeep<GoalOf<K>>,task:ReadonlyDeep<TaskState>,event:ReadonlyDeep<DomainEvent>,view:TaskView):TaskTransition;
  verifyCompletion(goal:ReadonlyDeep<GoalOf<K>>,task:ReadonlyDeep<TaskState>,view:TaskView):VerificationResult;
}
export interface DirectiveSubmission { ok: boolean; reason: string; directive: Directive | null; }
export interface ExecutionView { ship: Ship; directive: Directive; cargo: Stock; }
export const criterionFor = (goal: ObjectiveGoal): string => goal.kind === 'loadReturn'
  ? `actual load at ${goal.sourceId}, arrival at ${goal.destinationId}${goal.deliver ? ', attributed cargo delivered' : ', attributed cargo retained'}`
  : goal.kind === 'recovery' ? 'all enrolled Materials recovered and attributed cargo delivered; no unexplained loss'
  : goal.kind === 'operation'&&goal.action.type==='HAUL'?`actual ${goal.action.loadPolicy==='auto'?'available load':goal.action.amount+' '+goal.action.cargoKind} acquired at ${goal.action.sourceId} and attributed delivery to ${goal.action.targetId}, no unaccounted loss`
  : goal.kind === 'operation' ? `verified authoritative ${goal.action.type} outcome`
  : `verified authoritative ${goal.kind} outcome`;

export function createTask(objective: import('../types').Objective, shipId: string|null): TaskState {
  const status: TaskStatus=objective.status==='active'?(objective.consent==='accepted'?'accepted':'proposed'):objective.status;
  return {taskId:'task:'+objective.id,objectiveId:objective.id,ownerAgentId:objective.ownerAgentId,status,scheduling:'idle',revision:0,coordinationId:null,dependencyTaskIds:[],dependencies:[],checkpoint:null,currentStep:0,
    assignedShipIds:shipId?[shipId]:[],directiveIds:[],activeDirectiveId:null,completedRevision:null,steps:[],execution:{sectorIndex:0,scannedSectorIndices:[],projectId:null,carrierAgentId:null,selectedTargetId:null,searchedTargets:{}},scope:{revision:objective.revision,loadedBaseline:emptyStock(),deliveredBaseline:emptyStock(),lostBaseline:emptyStock(),divertedBaseline:emptyStock(),carryIn:emptyStock()},progress:{loaded:emptyStock(),delivered:emptyStock(),lost:emptyStock(),diverted:emptyStock(),targetAmounts:{},targetRecovered:{},completedDirectives:[],cycles:0,verified:false,legacyUnknown:false},
    blockReason:objective.reason,completionEvidence:[],processedEventIds:[],createdAt:objective.createdAt,updatedAt:objective.updatedAt,lastWorldKey:'',submissionKeys:{}};
}
