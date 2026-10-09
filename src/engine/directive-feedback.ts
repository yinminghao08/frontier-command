import type { Directive } from './types';
import type { SimulationEngine } from './engine';
import {emitDomainEvent} from './agent-runtime/journal';
/** A phase is an engine fact, recorded once per Directive and projected to the
 * task history. It never creates a primary chat reply or wakes cognition. */
export function directiveFeedback(e:SimulationEngine,d:Directive,text:string,phase:string) {
  if(e.state.agentRuntime.events.some(event=>event.type==='directiveProgress'&&event.directiveId===d.id&&event.payload.phase===phase))return;
  emitDomainEvent(e,{type:'directiveProgress',sourceId:d.id,objectiveId:d.objectiveId??null,taskId:d.taskId??null,directiveId:d.id,payload:{phase,text}});
  const task=d.objectiveId?e.runtime.taskForObjective(d.objectiveId):null;
  if(task){task.blockReason=/等待|满|不足|失效/.test(text)?text:null;task.updatedAt=e.state.time;}
}
