import type { Snapshot, Ship, Mission } from '../../engine/types';
import type { CommandSender } from '../types';
import type { ReactNode } from 'react';
import { ShipArt, Meter, Bar } from '../components/primitives';
import { PHASE, STATUS } from '../format';
import { HelmControls } from './HelmControls';

interface Props {
  world: Snapshot;
  ship: Ship;
  manual: boolean;
  assignment: Mission | undefined;
  openTask: (mission: Mission) => void;
  command: CommandSender;
  helmButton: (key: string, label: string) => ReactNode;
}
export function ShipInspector({
  world,
  ship,
  manual,
  assignment,
  openTask,
  command,
  helmButton,
}: Props) {
  return (
    <>
      <Bar code="VESSEL STATUS">舰船遥测</Bar>
      <div className="vessel-title">
        <span>{ship.registry}</span>
        <b className={manual ? 'warning-text' : ''}>{manual ? '直接操舰' : STATUS[ship.status]}</b>
      </div>
      <h2 className="ship-name">{ship.name}</h2>
      <p className="ship-role">{ship.role}</p>
      <ShipArt ship={ship} large />
      <div className="ship-measures">
        <span>
          SCI <b>{ship.science}</b>
        </span>
        <span>
          CARGO <b>{ship.capacity}</b>
        </span>
        <span>
          PWR <b>{ship.power}</b>
        </span>
      </div>
      <Meter label="舰体完整度" value={ship.hull} />
      <Meter label="护盾强度" value={ship.shield} max={ship.maxShield} />
      <div className="control-source">
        {manual ? 'COMMANDER / 指挥官直接控制' : 'RULE-BASED / 规则自动驾驶'}
      </div>
      {assignment && (
        <div className="assignment">
          <span>{PHASE[assignment.phase]}</span>
          <h3>{assignment.name}</h3>
          {assignment.deadline > 0 && !assignment.settled && (
            <small>
              剩余时限{' '}
              {Math.max(0, Math.ceil(assignment.deadline - world.time + assignment.started))}{' '}
              游戏分钟
            </small>
          )}
          {assignment.phase === 'working' && (
            <Meter
              label="现场执行"
              value={Math.min(assignment.work, assignment.duration)}
              max={assignment.duration}
            />
          )}
          <button className="text-button" onClick={() => openTask(assignment)}>
            查看行动详情 →
          </button>
        </div>
      )}
      {assignment?.phase === 'decision' && (
        <div className="decision-box">
          <h3>异常调查决策</h3>
          <p>
            {ship.science >= 70
              ? '传感器分析：周期性辐射，近距调查能提升样本精度，但会损伤舰体。'
              : '传感器分辨率有限。异常存在辐射风险，建议保守调查。'}
          </p>
          <button
            className="primary wide"
            onClick={() => command({ type: 'investigate', shipId: ship.id, choice: 'remote' })}
          >
            远距调查 · 安全
          </button>
          <button
            className="wide"
            onClick={() => command({ type: 'investigate', shipId: ship.id, choice: 'close' })}
          >
            近距调查 · 高收益 / 损伤
          </button>
        </div>
      )}
      {assignment?.kind === 'supply' && assignment.phase === 'outbound' && (
        <div className="button-row">
          <button onClick={() => command({ type: 'route', shipId: ship.id, route: 'safe' })}>
            安全航线
          </button>
          <button onClick={() => command({ type: 'route', shipId: ship.id, route: 'fast' })}>
            快速航线
          </button>
        </div>
      )}
      {assignment && !assignment.settled && ship.order === 'hold' && (
        <button
          className="primary wide"
          onClick={() => command({ type: 'resume', shipId: ship.id })}
        >
          恢复原任务
        </button>
      )}
      <div className="command-grid">
        {!manual ? (
          <button
            className="primary"
            disabled={!!world.manualShipId || ['disabled', 'repairing'].includes(ship.status)}
            onClick={() => command({ type: 'takeControl', shipId: ship.id })}
          >
            直接操舰
          </button>
        ) : (
          <>
            <button
              className="primary"
              onClick={() => command({ type: 'releaseControl', shipId: ship.id, resume: true })}
            >
              释放 · 恢复任务
            </button>
            <button
              onClick={() => command({ type: 'releaseControl', shipId: ship.id, resume: false })}
            >
              释放 · 保持位置
            </button>
          </>
        )}
        <button
          disabled={['docked', 'repairing', 'disabled', 'returning'].includes(ship.status)}
          onClick={() => command({ type: 'recall', shipId: ship.id })}
        >
          召回基地
        </button>
        <button
          disabled={['docked', 'repairing', 'disabled'].includes(ship.status)}
          onClick={() => command({ type: 'hold', shipId: ship.id })}
        >
          保持位置
        </button>
        <button
          disabled={['repairing', 'disabled'].includes(ship.status)}
          onClick={() => command({ type: 'scan', shipId: ship.id })}
        >
          扫描接触
        </button>
      </div>
      {manual && (
        <HelmControls world={world} ship={ship} command={command} helmButton={helmButton} />
      )}
      <Bar code={String(world.contacts.length).padStart(2, '0')}>已探测接触</Bar>
      <div className="contact-list">
        {world.contacts.map((t) => (
          <div key={t.id} className={`contact-row ${ship.targetId === t.id ? 'active' : ''}`}>
            <button
              onClick={() => command({ type: 'target', shipId: ship.id, targetId: t.id }, true)}
              disabled={t.retreating}
            >
              <span>{t.identified ? t.faction.toUpperCase() : 'UNKNOWN'}</span>
              <b>
                {t.retreating ? '撤离中' : t.hostile ? '敌对' : t.identified ? '已识别' : '待扫描'}
              </b>
            </button>
            {ship.targetId === t.id && !t.retreating && (
              <div className="button-row">
                <button
                  disabled={!t.identified}
                  onClick={() => command({ type: 'hail', shipId: ship.id, targetId: t.id })}
                >
                  警告驱离
                </button>
                <button
                  disabled={!t.identified}
                  onClick={() => command({ type: 'engage', shipId: ship.id, targetId: t.id })}
                >
                  拦截目标
                </button>
              </div>
            )}
          </div>
        ))}
        {!world.contacts.length && (
          <p className="empty-state">
            未发现接触
            <br />
            <small>派遣巡逻舰前往边境，或接近后扫描。</small>
          </p>
        )}
      </div>
    </>
  );
}
