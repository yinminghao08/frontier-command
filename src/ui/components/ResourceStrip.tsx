import type { Snapshot } from '../../engine/types';
import type { CommandSender } from '../types';

interface Props {
  world: Snapshot;
  command: CommandSender;
}
export function ResourceStrip({ world, command }: Props) {
  return (
    <div className="resource-strip">
      <div>
        <span>就绪舰船</span>
        <b>
          {world.ships.filter((s) => s.status === 'docked').length}
          <small> / 03</small>
        </b>
      </div>
      <div>
        <span>行动配额</span>
        <b>{world.resources.allocation.toString().padStart(3, '0')}</b>
      </div>
      <div>
        <span>科研数据</span>
        <b>{world.resources.science.toString().padStart(3, '0')}</b>
      </div>
      <div>
        <span>区域威胁</span>
        <b className={world.threat > 60 ? 'danger-text' : ''}>
          {world.threat}
          <small> / 100</small>
        </b>
      </div>
      <div>
        <span>补给 / 材料</span>
        <b>
          {world.resources.supplies}
          <small> / {world.resources.materials}</small>
        </b>
      </div>
      <div className="transport">
        <button
          className={world.paused ? 'primary' : ''}
          onClick={() => command({ type: 'pause', paused: !world.paused }, true)}
          aria-label={world.paused ? '继续模拟' : '暂停模拟'}
        >
          {world.paused ? '▶ 继续' : 'Ⅱ 暂停'}
        </button>
        <div>
          {([1, 2, 4] as const).map((speed) => (
            <button
              key={speed}
              disabled={!!world.manualShipId && speed !== 1}
              className={world.speed === speed ? 'selected' : ''}
              onClick={() => command({ type: 'speed', speed }, true)}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
