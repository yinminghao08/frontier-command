import type { Snapshot, Ship, Mission, Route } from '../../engine/types';
import type { Page, CommandSender } from '../types';
import { Meter, Bar } from '../components/primitives';
import { PHASE, STATUS, KIND } from '../format';

interface Props {
  world: Snapshot;
  inspected: Mission;
  selected: string;
  setSelected: (id: string) => void;
  route: Route;
  setRoute: (route: Route) => void;
  ship: Ship;
  command: CommandSender;
  setMission: (id: string | null) => void;
  setPage: (page: Page) => void;
}
export function MissionInspector({
  world,
  inspected,
  selected,
  setSelected,
  route,
  setRoute,
  ship,
  command,
  setMission,
  setPage,
}: Props) {
  return (
    <>
      <Bar code={inspected.id.toUpperCase()}>行动简报</Bar>
      <span className={`task-kind ${inspected.kind}`}>{KIND[inspected.kind]}</span>
      <h2>{inspected.name}</h2>
      <p>{inspected.brief}</p>
      <dl className="spec-list">
        <div>
          <dt>当前阶段</dt>
          <dd>{PHASE[inspected.phase]}</dd>
        </div>
        <div>
          <dt>预计总耗时</dt>
          <dd>约 2—4 分钟</dd>
        </div>
        <div>
          <dt>现场工作</dt>
          <dd>{inspected.duration} 秒</dd>
        </div>
        <div>
          <dt>注意力</dt>
          <dd>{inspected.attention}</dd>
        </div>
        <div>
          <dt>风险</dt>
          <dd>{inspected.risk}</dd>
        </div>
      </dl>
      <p className="info-line">{inspected.requirement}</p>
      {inspected.phase === 'available' ? (
        <>
          <label className="field-label" htmlFor="assign-ship">
            执行舰船
          </label>
          <select id="assign-ship" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {world.ships.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {STATUS[s.status]}
              </option>
            ))}
          </select>
          {inspected.kind === 'supply' && (
            <>
              <label className="field-label">航线方案</label>
              <div className="segmented">
                <button
                  className={route === 'safe' ? 'selected' : ''}
                  onClick={() => setRoute('safe')}
                >
                  安全航线
                </button>
                <button
                  className={route === 'fast' ? 'selected' : ''}
                  onClick={() => setRoute('fast')}
                >
                  快速航线
                </button>
              </div>
              <small className="muted">
                快速航线更短且航速提高 25%，穿越微陨石带会造成 4—12 点舰体损伤。
              </small>
            </>
          )}
          <button
            className="primary wide"
            disabled={ship.status !== 'docked' || ship.capacity < inspected.cargoRequired}
            onClick={async () => {
              const r = await command({
                type: 'dispatch',
                shipId: selected,
                missionId: inspected.id,
                route,
              });
              if (r.ok) {
                setMission(null);
                setPage('overview');
              }
            }}
          >
            授权派遣 →
          </button>
          {ship.capacity < inspected.cargoRequired && (
            <p className="warning-text">货舱不足，请选择子午号。</p>
          )}
        </>
      ) : (
        <>
          <p>执行舰船：{world.ships.find((s) => s.id === inspected.shipId)?.name ?? '—'}</p>
          <Meter
            label="现场执行"
            value={Math.min(inspected.work, inspected.duration)}
            max={inspected.duration}
          />
          {inspected.result && <p className="result-box">{inspected.result}</p>}
          <button
            className="wide"
            onClick={() => {
              setMission(null);
              setPage('overview');
            }}
          >
            查看战术态势
          </button>
          {['complete', 'failed'].includes(inspected.phase) && (
            <button
              className="wide"
              disabled={world.ships.some((s) => s.missionId === inspected.id)}
              onClick={() => command({ type: 'renew', missionId: inspected.id })}
            >
              重新开放行动窗口
            </button>
          )}
        </>
      )}
    </>
  );
}
