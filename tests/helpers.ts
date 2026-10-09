import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import { createOrionState } from '../src/engine/orion/generation';
import type { Action } from '../src/engine/types';
import { worldSchema as legacySchema } from '../src/engine/legacy-v12/save-schema';
import { worldSchema as v15Schema } from '../src/engine/legacy-v15/save-schema';
import { worldSchema as v11Schema } from '../src/engine/legacy-v11/save-schema';
import type { WorldState } from '../src/engine/types';
/** Explicitly construct an authentic old fixture; never relabel a v13 save as v12. */
export function v12Fixture(world: WorldState) {
  const {
    commitments: _commitments,
    settledOutcomes: _settlements,
    agentRuntime: _runtime,
    objectives: _objectives,
    ...base
  } = structuredClone(world);
  const cleanDirective = (d: NonNullable<WorldState['ships'][number]['current']>) => {
    const { contractId: _contract, cycle: _cycle, controlMode: _mode, objectiveId:_objective, originInteractionId:_interaction, submissionKey:_key, ...old } = d;
    return old;
  };
  const cleanShips = <T extends WorldState['ships'][number]>(ships: T[]) =>
    ships.map(({ ammoAlertActive: _ammoAlert, ...s }) => ({
      ...s,
      current: s.current ? cleanDirective(s.current) : null,
      queue: s.queue.map(cleanDirective),
      suspended: s.suspended.map(cleanDirective),
    }));
  return legacySchema.parse({
    ...base,
    version: 12,
    agents: world.agents.map((a) => {
      const {
        profile: _profile,
        psychology: _psychology,
        longTermGoal: _goal,
        taskPreferences: _preferences,
        rewardCredits: _rewards,
        feedbackEvents: _feedback,
        ...old
      } = a;
      const {
        contextKey: _context,
        dangerKey: _danger,
        events: _events,
        ...decision
      } = old.decision;
      return { ...old, decision };
    }),
    chatChannels: world.chatChannels.filter((c) => c.kind !== 'reports'),
    chatMessages: world.chatMessages
      .filter((m) => m.channelId !== 'system-reports')
      .map((m) => {
        const {
          origin: _origin,
          eventId: _event,
          requestId: _request,
          controlMode: _mode,
          ...old
        } = m;
        return old;
      }),
    admiralTasks: world.objectives.map((t) => {
      const {
        schemaVersion:_schema, originInteractionId:_origin, issuerId:_issuer, ownerAgentId:_owner, goal:_typedGoal, constraints:_constraints, completionCriteria:_criteria, revision:_revision, createdAt:_created, updatedAt:_updated, originalInstruction:_instruction,
        controlMode: _mode,
        consent: _consent,
        conditions: _conditions,
        conditionVersion: _version,
        rounds: _rounds,
        turnAgentId: _turn,
        creditsApproved: _approved,
        ...old
      } = t;
      return old;
    }),
    escortRequests: world.escortRequests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      responderId: r.responderId,
      targetShipId: r.targetShipId,
      created: r.created,
      deadline: r.deadline,
      started: r.started,
      status: r.status,
    })),
    ships: cleanShips(world.ships),
    enemies: cleanShips(world.enemies),
    civilians: cleanShips(world.civilians),
  });
}
export function v11Fixture(world: WorldState) {
  const older = v12Fixture(world),
    { admiralTasks: _tasks, ...base } = older;
  const directive = (d: NonNullable<(typeof older.ships)[number]['current']>) => {
    const {
      executorAgentId: _executor,
      sourceMessageId: _message,
      taskId: _task,
      allowWormholes: _permission,
      ...old
    } = d;
    return old;
  };
  const ships = <T extends (typeof older.ships)[number]>(values: T[]) =>
    values.map((s) => ({
      ...s,
      current: s.current ? directive(s.current) : null,
      queue: s.queue.map(directive),
      suspended: s.suspended.map(directive),
    }));
  return v11Schema.parse({
    ...base,
    version: 11,
    agents: older.agents.map((a) => {
      const { lastAdmiralMessageId: _cursor, ...decision } = a.decision;
      return { ...a, decision };
    }),
    chatMessages: older.chatMessages.map((m) => {
      const { purpose: _purpose, replyTo: _reply, ...old } = m;
      return old;
    }),
    ships: ships(older.ships),
    enemies: ships(older.enemies),
    civilians: ships(older.civilians),
  });
}
export function quietEngine(seed = 236807) {
  const e = new SimulationEngine(createWorld(seed));
  e.state.enemies = [];
  e.state.orion = createOrionState();
  e.state.factions.orion.credits = 0;
  for (const l of e.state.locations.filter((l) => l.owner === 'orion'))
    l.stock = { materials: 0, photon: 0, quantum: 0, specialFinds: 0 };
  return e;
}
export function issue(
  e: SimulationEngine,
  action: Action,
  shipId = 'verity',
  mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT' = 'REPLACE',
) {
  return e.dispatchCommand({ type: 'issueDirective', shipIds: [shipId], mode, action });
}
export function run(e: SimulationEngine, minutes: number) {
  for (let i = 0; i < Math.round(minutes * 10); i++) {
    if (e.state.status === 'commandLost') break;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
}
export function until(e: SimulationEngine, predicate: () => boolean, maxMinutes = 600) {
  for (let i = 0; i < maxMinutes * 10 && !predicate(); i++) {
    if (e.state.status === 'commandLost') break;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
  if (!predicate()) throw Error('Simulation predicate timed out at ' + e.state.time);
}

/** Authentic published protocol for migration tests, not a relabelled current save. */
export function v15Fixture(world: WorldState) {
  const {agentRuntime:_runtime,objectives,...base}=structuredClone(world);
  const clean=(d: NonNullable<WorldState['ships'][number]['current']>)=>{
    const {objectiveId:_o,originInteractionId:_i,submissionKey:_s,...old}=d;
    return {...old,taskId:world.objectives.some(o=>o.id===(d.objectiveId??d.taskId)&&o.messageId>0)?d.objectiveId??d.taskId:null};
  };
  const oldTasks=objectives.filter(o=>o.messageId>0).map(o=>{
    const {schemaVersion:_schema,originInteractionId:_i,issuerId:_issuer,ownerAgentId:_owner,goal:_goal,constraints:_constraints,completionCriteria:_c,revision:_r,createdAt:_created,updatedAt:_updated,originalInstruction:_instruction,amendments:_amendments,conditionHistory:_conditionHistory,...old}=o;
    const {selectedTargetId:_selected,...execution}=world.agentRuntime.tasks.find(t=>t.objectiveId===o.id)!.execution;
    return {...old,...execution,status:['interrupted','completed_partial'].includes(old.status)?'blocked':old.status,...(o.goal.kind==='recovery'?{salvage:{wreckIds:o.goal.wreckIds,destinationId:o.goal.destinationId}}:{})};
  });
  return v15Schema.parse({...base,version:15,agents:base.agents.map(a=>({...a,assignedShipId:world.assignments.find(link=>link.operatorId===a.id)?.shipId??null,modelConfig:{model:a.modelConfig.model,reasoningEffort:a.modelConfig.reasoningEffort===null?null:['low','medium','high'].includes(a.modelConfig.reasoningEffort)?a.modelConfig.reasoningEffort:'none'}})),admiralTasks:oldTasks,commitments:base.commitments.map(({conditionVersion:_version,...p})=>p),escortRequests:base.escortRequests.map(({conditionHistory:_history,...r})=>r),ships:base.ships.map(s=>({...s,current:s.current?clean(s.current):null,queue:s.queue.map(clean),suspended:s.suspended.map(clean)})),wrecks:base.wrecks.map(({sourceShipId:_ship,sourceClassId:_class,...w})=>w)});
}
export function v14Fixture(world: WorldState) {
  const v15=v15Fixture(world);
  return {...v15,version:14,agents:v15.agents.map(({stateDynamics:_d,...a})=>a)};
}
