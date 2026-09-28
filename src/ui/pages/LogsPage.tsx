import type { Snapshot } from '../../engine/types';
import { time } from '../format';

interface Props {
  world: Snapshot;
}
export function LogsPage({ world }: Props) {
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">COMMAND RECORDS</span>
          <h2>行动日志</h2>
        </div>
        <span className="mono">{world.logs.length} RECORDS</span>
      </div>
      <p className="muted">
        记录由模拟引擎产生，保存最近 180 项事件。任务结算包含收益、损伤与原因。
      </p>
      <div className="full-logs">
        {[...world.logs].reverse().map((log) => (
          <div key={log.id} className={`log-row ${log.level}`}>
            <time>{time(log.time)}</time>
            <span>{log.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
