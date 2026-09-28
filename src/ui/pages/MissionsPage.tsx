import type { Snapshot, Mission } from '../../engine/types';
import { PHASE, KIND } from '../format';

interface Props {
  world: Snapshot;
  filter: string;
  setFilter: (filter: string) => void;
  missionId: string | null;
  openTask: (mission: Mission) => void;
}
export function MissionsPage({ world, filter, setFilter, missionId, openTask }: Props) {
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">OPERATIONS MANAGEMENT</span>
          <h2>任务中心</h2>
        </div>
        <span className="mono">06 MISSION WINDOWS</span>
      </div>
      <div className="filter-row">
        {[
          ['all', '全部'],
          ['explore', '探索'],
          ['supply', '补给'],
          ['patrol', '巡逻'],
        ].map(([id, label]) => (
          <button
            className={filter === id ? 'selected' : ''}
            key={id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mission-grid">
        {world.missions
          .filter((m) => filter === 'all' || m.kind === filter)
          .map((m) => (
            <button
              className={`mission-card ${m.kind} ${missionId === m.id ? 'active' : ''}`}
              key={m.id}
              onClick={() => openTask(m)}
            >
              <div className="card-tag">
                <span>{KIND[m.kind]}</span>
                <b>{PHASE[m.phase]}</b>
              </div>
              <h3>{m.name.split(' · ')[0]}</h3>
              <p>{m.name.split(' · ')[1]}</p>
              <p className="brief">{m.brief}</p>
              <div className="card-data">
                <span>
                  注意力<b>{m.attention}</b>
                </span>
                <span>
                  风险<b>{m.risk}</b>
                </span>
              </div>
              <div className="card-foot">
                <span>
                  {m.kind === 'explore'
                    ? '科研数据'
                    : m.kind === 'supply'
                      ? '补给交付 / 配额'
                      : '情报 / 配额'}
                </span>
                <b>{m.phase === 'available' ? '查看与派遣 →' : '行动详情 →'}</b>
              </div>
            </button>
          ))}
      </div>
    </>
  );
}
