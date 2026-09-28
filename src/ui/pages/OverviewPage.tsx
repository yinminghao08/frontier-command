import type { Snapshot, Ship, Mission } from '../../engine/types';
import type { CommandSender } from '../types';
import { Bar } from '../components/primitives';
import { STATUS, KIND } from '../format';
import { TacticalMap } from '../../TacticalMap';

interface Props {
  world: Snapshot;
  manual: boolean;
  active: Mission[];
  selected: string;
  selectShip: (id: string) => void;
  command: CommandSender;
  ship: Ship;
  openTask: (mission: Mission) => void;
}
export function OverviewPage({
  world,
  manual,
  active,
  selected,
  selectShip,
  command,
  ship,
  openTask,
}: Props) {
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">SECTOR TACTICAL DISPLAY</span>
          <h2>{manual ? '直接操舰' : '曙光边区'}</h2>
        </div>
        <span className={`status-pill ${world.paused ? '' : 'live'}`}>
          <i />
          {world.paused ? '模拟暂停' : manual ? 'MANUAL CONTROL' : '实时态势'}
        </span>
      </div>
      <div className="map-frame">
        <div className="map-topline">
          <span>TACTICAL / 07-ALPHA</span>
          <span>
            {world.contacts.length.toString().padStart(2, '0')} CONTACTS · {active.length} ACTIVE
            OPS
          </span>
        </div>
        <TacticalMap
          world={world}
          selected={selected}
          onShip={selectShip}
          onTarget={(targetId) => command({ type: 'target', shipId: ship.id, targetId }, true)}
          manual={manual}
        />
        <div className="map-legend">
          <span>
            <i className="legend-fleet" />
            己方舰队
          </span>
          <span>
            <i className="legend-unknown" />
            接触
          </span>
          <span>
            <i className="legend-border" />
            边境
          </span>
          <span>
            {manual ? 'W/S 推进 · A/D 转向 · SPACE 开火' : '点击舰船查看状态 · 点击接触选择目标'}
          </span>
        </div>
      </div>
      <div className="fleet-strip">
        {world.ships.map((s) => (
          <button
            className={`fleet-chip ${s.id} ${selected === s.id ? 'active' : ''}`}
            key={s.id}
            onClick={() => selectShip(s.id)}
          >
            <span className="chip-top">
              {s.registry}
              <i className={s.status === 'docked' ? 'ready-dot' : 'busy-dot'} />
            </span>
            <strong>{s.name}</strong>
            <span>
              {s.role.split(' · ')[0]} <b>{STATUS[s.status]}</b>
            </span>
            <div className="mini-track">
              <i style={{ width: `${s.hull}%` }} />
            </div>
          </button>
        ))}
      </div>
      <Bar code="MISSION CONTROL">待办行动</Bar>
      <div className="quick-missions">
        {world.missions
          .filter((m) => m.phase === 'available')
          .slice(0, 3)
          .map((m) => (
            <button key={m.id} className={`quick-task ${m.kind}`} onClick={() => openTask(m)}>
              <span>{KIND[m.kind]}</span>
              <strong>{m.name.split(' · ')[0]}</strong>
              <b>进入行动 →</b>
            </button>
          ))}
        {!world.missions.some((m) => m.phase === 'available') && (
          <p className="muted">所有任务已派遣。任务中心可以查看结算并重新开放任务。</p>
        )}
      </div>
    </>
  );
}
