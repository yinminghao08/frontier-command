import type { Snapshot } from '../../engine/types';
import type { CommandSender } from '../types';
import { ShipArt, Meter, Bar } from '../components/primitives';
import { STATUS } from '../format';

interface Props {
  world: Snapshot;
  selectShip: (id: string) => void;
  command: CommandSender;
}
export function FleetPage({ world, selectShip, command }: Props) {
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">STARBASE SUPPORT SERVICES</span>
          <h2>舰队管理</h2>
        </div>
        <span className="mono">DAWN / SB-A01</span>
      </div>
      <div className="stock-grid">
        <div>
          <span>维修材料</span>
          <b>{world.resources.materials}</b>
          <small>MATERIALS</small>
        </div>
        <div>
          <span>补给库存</span>
          <b>{world.resources.supplies}</b>
          <small>SUPPLIES</small>
        </div>
        <div>
          <span>巡逻情报</span>
          <b>{world.resources.intel}</b>
          <small>INTELLIGENCE</small>
        </div>
      </div>
      <p className="info-line">
        常规补给每 180 游戏分钟抵达：45 补给 / 15 材料。下一批：
        {180 - Math.floor(world.time % 180)} 游戏分钟。
      </p>
      <Bar code="BERTHS 01—03">舰船状态与维修</Bar>
      <div className="berths">
        {world.ships.map((s) => (
          <div className={`berth ${s.id}`} key={s.id}>
            <ShipArt ship={s} />
            <div>
              <span className="mono">{s.registry}</span>
              <h3>{s.name}</h3>
              <p>
                {s.role} · {STATUS[s.status]}
              </p>
              <Meter label="舰体" value={s.hull} />
              <Meter label="护盾" value={s.shield} max={s.maxShield} />
            </div>
            <div className="berth-actions">
              <button onClick={() => selectShip(s.id)}>查看舰船</button>
              <button
                disabled={s.status !== 'docked' || (s.hull >= 100 && s.shield >= s.maxShield)}
                onClick={() => command({ type: 'repair', shipId: s.id })}
              >
                安排维修
              </button>
              {s.status === 'repairing' && (
                <small>
                  {s.emergency ? '基础抢修' : '标准维修'} · {Math.ceil(s.repair)} 游戏分钟
                </small>
              )}
            </div>
          </div>
        ))}
      </div>
      <Bar code="COLONY NETWORK">前哨储备</Bar>
      <div className="outpost-list">
        {world.locations
          .filter((l) => ['colony', 'outpost'].includes(l.kind))
          .map((l) => (
            <Meter key={l.id} label={l.name} value={l.supply} />
          ))}
      </div>
    </>
  );
}
