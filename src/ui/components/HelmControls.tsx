import type { Snapshot, Ship } from '../../engine/types';
import type { CommandSender } from '../types';
import type { ReactNode } from 'react';

interface Props {
  world: Snapshot;
  ship: Ship;
  command: CommandSender;
  helmButton: (key: string, label: string) => ReactNode;
}
export function HelmControls({ world, ship, command, helmButton }: Props) {
  return (
    <div className="helm">
      <span>
        HELM CONTROL <b>{Math.round(ship.throttle * 100)}%</b>
      </span>
      <div>
        {helmButton('KeyW', 'W 推进')}
        {helmButton('KeyS', 'S 减速')}
        {helmButton('KeyA', 'A 左转')}
        {helmButton('KeyD', 'D 右转')}
      </div>
      <button
        className="wide fire-button"
        disabled={world.paused || ship.cooldown > 0}
        onClick={() => command({ type: 'fire', shipId: ship.id })}
      >
        {ship.cooldown > 0 ? `相位阵列冷却 ${ship.cooldown.toFixed(1)}s` : 'SPACE / 发射相位武器'}
      </button>
    </div>
  );
}
