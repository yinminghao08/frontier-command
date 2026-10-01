import type { ControllerIntent, Observation, OperationOrder, Point } from './types';
import { dist, authorized } from './navigation';
import { shouldRetreat } from './combat';
export function decideExecution(
  observation: Observation,
  order: OperationOrder,
  objective: Point | null,
): ControllerIntent {
  const { ship, contacts, time } = observation;
  if (shouldRetreat(ship, order)) return { type: 'retreat' };
  if (order.held) return { type: 'hold' };
  const targets = contacts
    .filter(
      (i) =>
        i.live &&
        !i.resolved &&
        ['IDENTIFIED', 'TRACKED'].includes(i.level) &&
        authorized(i, order.border),
    )
    .filter(
      (i) =>
        order.roe === 'WEAPONS FREE' ||
        (order.roe === 'ENGAGE HOSTILES' && i.hostile) ||
        (order.roe === 'RETURN FIRE' &&
          i.hostile &&
          ((ship.lastAttackerId === i.id && time - ship.attackedAt < 12) ||
            (i.lastAttackTargetId === order.objective.id &&
              i.lastAttackAt !== undefined &&
              time - i.lastAttackAt < 12))),
    )
    .filter((i) =>
      order.kind === 'defense' ? objective && dist(i, objective) < 260 : dist(i, ship) < 165,
    )
    .sort((a, b) => {
      const weight = { normal: 0, high: 100, urgent: 240 }[order.priority];
      const score = (i: typeof a) =>
        dist(i, ship) -
        (i.lastAttackTargetId === order.objective.id &&
        i.lastAttackAt !== undefined &&
        time - i.lastAttackAt < 12
          ? weight
          : 0);
      return score(a) - score(b) || a.id.localeCompare(b.id);
    });
  if (targets[0]) return { type: 'engage', contactId: targets[0].id };
  return {
    type: order.kind === 'defense' ? 'defend' : order.kind === 'transport' ? 'transport' : 'scan',
  };
}
