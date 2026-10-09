import type { Directive } from './types';
import type { SimulationEngine } from './engine';
/** A phase is an engine fact, recorded once per Directive and projected to the
 * task history. It never creates a primary chat reply or wakes cognition. */
export function directiveFeedback(e: SimulationEngine, d: Directive, text: string, phase: string) {
  if (!e.runtime.recordDirectiveProgress(d, text, phase)) return;
  const task = d.objectiveId ? e.runtime.taskForObjective(d.objectiveId) : null;
  if (task) {
    task.blockReason = /等待|满|不足|失效/.test(text) ? text : null;
    task.updatedAt = e.state.time;
  }
}
