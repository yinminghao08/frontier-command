import type { Directive } from './types';
import type { SimulationEngine } from './engine';
import { appendChat, privateChannel, REPORT_CHANNEL } from './chat';
export function directiveFeedback(e: SimulationEngine, d: Directive, text: string, phase: string) {
  const task=d.objectiveId?e.runtime.taskForObjective(d.objectiveId):null;
  if(task){task.blockReason=/等待|满|不足|失效/.test(text)?text:null;task.updatedAt=e.state.time;return;}
  // Untasked feedback is a structured engine fact and never a primary reply.
  e.record('directiveProgress',d.id+' / '+phase+' / '+text,null,false);

}
