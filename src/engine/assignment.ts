import type { Assignment } from './types';
/** Assignment is the only persisted relation. This non-enumerable read view keeps
 * Agent consumers convenient while preventing a second saved ship identity. */
export function assignmentView<T extends { id: string }>(
  world: { assignments: Assignment[] },
  agent: T,
): T & { readonly assignedShipId: string | null } {
  const view = {
    ...agent,
    get assignedShipId() {
      return world.assignments.find((a) => a.operatorId === agent.id)?.shipId ?? null;
    },
  };
  Object.defineProperty(view, 'assignedShipId', { enumerable: false });
  return view;
}
export function bindAssignment(world: { assignments: Assignment[] }, agent: { id: string }) {
  Object.defineProperty(agent, 'assignedShipId', {
    configurable: true,
    enumerable: false,
    get: () => world.assignments.find((a) => a.operatorId === agent.id)?.shipId ?? null,
  });
}
