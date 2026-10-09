import type { Snapshot } from '../engine/types';
export function vesselAgent(world: Snapshot, shipId: string) {
  const link = world.assignments.find((a) => a.shipId === shipId);
  return world.agents.find((a) => a.id === link?.operatorId) ?? null;
}
export function vesselControl(world: Snapshot, shipId: string) {
  const agent = vesselAgent(world, shipId),
    ship = world.ships.find((s) => s.id === shipId);
  return (
    (agent?.name ?? '未分配 Agent') +
    (ship?.current?.source === 'admiral' && ship.current.controlMode === 'direct'
      ? ' · Admiral 直接指挥'
      : '')
  );
}
