import type { Snapshot } from '../../engine/types';
import type { Page } from '../types';
import { time } from '../format';

interface Props {
  world: Snapshot;
  setPage: (page: Page) => void;
}
export function EventFooter({ world, setPage }: Props) {
  return (
    <footer className="event-footer">
      <span>
        COMMS
        <br />
        <b>最近事件</b>
      </span>
      <div>
        {world.logs
          .slice(-2)
          .reverse()
          .map((log) => (
            <p className={log.level} key={log.id}>
              <time>{time(log.time)}</time>
              {log.text}
            </p>
          ))}
      </div>
      <button onClick={() => setPage('logs')}>完整日志 ↗</button>
    </footer>
  );
}
