import type { Snapshot, OrderKind } from '../engine/types';
import type { TimelineStatus } from '../engine/timeline';
import type { Page, CommandSender } from './types';
import type { Selection } from '../StrategicMap';
import { SHIP_CLASSES } from '../engine/definitions/ships';
import { gameCalendar } from '../engine/clock';
import { KIND, PHASE } from './OrderComposer';
import { LcarsDrawer, LcarsButton, LcarsField, LcarsTextBar } from './components/Lcars';
export function ManagementDrawer({
  page,
  world,
  timeline,
  close,
  select,
  create,
  command,
  save,
  newFrontier,
}: {
  page: Page;
  world: Snapshot;
  timeline: TimelineStatus;
  close: () => void;
  select: (s: Selection) => void;
  create: (k: OrderKind) => void;
  command: CommandSender;
  save: () => void;
  newFrontier: () => void;
}) {
  return (
    <LcarsDrawer title={page + ' / COMMAND RECORDS'} label={page + ' 工作面板'} onClose={close}>
      {page === 'OPERATIONS' && (
        <>
          <div className="inline-actions">
            {(['defense', 'transport', 'explore'] as const).map((k) => (
              <LcarsButton
                key={k}
                disabled={world.status !== 'active'}
                sound="navigation"
                onClick={() => create(k)}
              >
                新建{KIND[k]}
              </LcarsButton>
            ))}
          </div>
          <div className="record-list">
            {[...world.orders].reverse().map((o) => (
              <LcarsButton
                key={o.id}
                shape="rail"
                sound="navigation"
                className="record-row"
                onClick={() => select({ type: 'order', id: o.id })}
              >
                <b>
                  {o.id} / {KIND[o.kind]}
                </b>
                <span>
                  {PHASE[o.phase]} · {o.outcome ?? o.priority}
                </span>
                <small>{o.result || o.shipIds.length + ' assets assigned'}</small>
              </LcarsButton>
            ))}
            {!world.orders.length && <p>选择星图对象，指定目标、资产与执行政策。</p>}
          </div>
        </>
      )}
      {page === 'PERSONNEL' && (
        <>
          <p className="muted">
            确定性规则操作者 / 独立身份与可调整的舰船分配。当前没有 LLM、人格或成长系统。
          </p>
          <div className="record-list">
            {world.operators.map((op) => {
              const a = world.assignments.find((a) => a.operatorId === op.id);
              return (
                <div className="personnel-row" key={op.id}>
                  <b>{op.name}</b>
                  <small>
                    {op.availability === 'vesselLost'
                      ? '执行主体不可用 · 原执行舰已损失'
                      : 'RULES CONTROLLER'}
                  </small>
                  <LcarsField>
                    ASSIGNMENT
                    <select
                      data-sound="none"
                      aria-label={'分配操作者 ' + op.id}
                      disabled={op.availability !== 'available' || world.status !== 'active'}
                      value={a?.shipId ?? ''}
                      onChange={(e) =>
                        command({
                          type: 'assignOperator',
                          operatorId: op.id,
                          shipId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">未分配</option>
                      {world.ships.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </LcarsField>
                </div>
              );
            })}
          </div>
        </>
      )}
      {page === 'STARBASE' && (
        <>
          <div className="armory-summary">
            <span>
              PHOTON <b>{world.armory.stock.photon - world.armory.reserved.photon}</b>
            </span>
            <span>
              QUANTUM <b>{world.armory.stock.quantum - world.armory.reserved.quantum}</b>
            </span>
            <small>
              可用实物库存 · 已预留 {world.armory.reserved.photon} / {world.armory.reserved.quantum}
            </small>
          </div>
          <div className="record-list">
            {world.ships.map((s) => (
              <LcarsButton
                key={s.id}
                shape="rail"
                sound="navigation"
                className="record-row"
                onClick={() => select({ type: 'ship', id: s.id })}
              >
                <b>{s.name}</b>
                <span>
                  {SHIP_CLASSES[s.classId].name} · {s.status}
                </span>
                <small>
                  HULL {Math.ceil(s.hull)} / PHOTON {s.photon} / QUANTUM {s.quantum}
                </small>
              </LcarsButton>
            ))}
          </div>
        </>
      )}
      {page === 'COLONIES' && (
        <div className="record-list">
          {world.locations
            .filter(
              (l) => l.regionId === 'federation' && ['colony', 'mine', 'outpost'].includes(l.kind),
            )
            .map((l) => (
              <LcarsButton
                key={l.id}
                shape="rail"
                sound="navigation"
                className="record-row"
                onClick={() => select({ type: 'location', id: l.id })}
              >
                <b>
                  {l.name} {l.hull <= 0 ? ' / DESTROYED' : l.distress ? ' / DISTRESS' : ''}
                </b>
                <span>
                  HULL {Math.ceil(l.hull)} · SUPPLIES {Math.floor(l.stock.supplies)}
                </span>
                <small>
                  MEDICAL {l.stock.medical} / MATERIALS {l.stock.materials}
                </small>
              </LcarsButton>
            ))}
        </div>
      )}
      {page === 'ARCHIVE' && (
        <>
          <div className="inline-actions">
            <LcarsButton onClick={save}>立即保存</LcarsButton>
            <LcarsButton tone="danger" sound="navigation" onClick={newFrontier}>
              BEGIN NEW FRONTIER
            </LcarsButton>
          </div>
          <LcarsTextBar>VESSEL LOSSES / {world.losses.length}</LcarsTextBar>
          <div className="record-list">
            {world.losses.map((l) => (
              <LcarsButton
                key={l.shipId}
                shape="rail"
                sound="navigation"
                className="record-row loss-row"
                onClick={() => select({ type: 'loss', id: l.shipId })}
              >
                <b>{l.name}</b>
                <span>
                  DAY {gameCalendar(l.tick).day} · {l.reason}
                </span>
                <small>永久损失 / {l.operatorIds.length} 个执行主体撤销分配</small>
              </LcarsButton>
            ))}
            {!world.losses.length && <p className="muted">当前分支无舰船损失。</p>}
          </div>
          <LcarsTextBar>TIMELINES</LcarsTextBar>
          {timeline.branches.map((b) => (
            <div key={b.id} className="timeline-row">
              <b>
                {b.id} {b.id === timeline.activeId ? ' / CURRENT' : ''}
              </b>
              <span>
                DAY {gameCalendar(b.tick).day} ·{' '}
                {b.status === 'commandLost' ? 'COMMAND LOST' : 'ACTIVE'} · {b.lossCount} LOSSES
              </span>
              <small>
                {b.parent
                  ? 'RESTORED FROM ' + b.parent.id + ' / DAY ' + b.parent.day
                  : 'NEW FRONTIER'}
              </small>
            </div>
          ))}
          <LcarsTextBar>OBSERVABLE REPORTS</LcarsTextBar>
          <div className="archive-log">
            {[...world.logs].reverse().map((l) => (
              <p key={l.id}>
                <small>{Math.floor(l.time)}m</small> {l.text}
              </p>
            ))}
          </div>
        </>
      )}
    </LcarsDrawer>
  );
}
