import { useState } from 'react';
import type { Action, Snapshot, ModuleId } from '../engine/types';
import type { Selection } from '../StrategicMap';
import type { CommandSender } from './types';
import { LcarsDialog, LcarsButton, LcarsField, LcarsTextBar } from './components/Lcars';
import { ACTION_LABELS } from './format';
import { frontierSectors, sectorId } from '../engine/world-generation';
import { capabilities, cargoUsed } from '../engine/capabilities';
import { MODULES } from '../engine/definitions/progression';
import { routeEstimate } from '../engine/navigation';
export type ComposerRequest = { action: Action; shipId?: string };
export function defaultAction(
  type: Action['type'],
  w: Snapshot,
  selection: Selection | null = null,
): Action {
  const id = selection && 'id' in selection ? selection.id : '',
    site = w.bodies.find((b) => b.id === id),
    facility = w.locations.find((l) => l.id === id),
    target = site?.id ?? facility?.id ?? w.contacts[0]?.id ?? 'base';
  switch (type) {
    case 'MOVE':
      return {
        type,
        point: selection?.type === 'point' ? { x: selection.x, y: selection.y } : { x: 200, y: 0 },
      };
    case 'EXPLORE':
      return {
        type,
        sector: selection?.type === 'sector' ? { q: selection.q, r: selection.r } : { q: 0, r: -1 },
        approach: 'remote',
      };
    case 'SURVEY':
      return {
        type,
        targetId:
          site?.id ??
          w.systems.find((s) => s.id === id)?.id ??
          w.bodies.find((b) => b.kind === 'anomaly')?.id ??
          target,
        approach: 'close',
        deep: false,
      };
    case 'MINE':
      return {
        type,
        targetId:
          site?.kind === 'resource'
            ? site.id
            : (w.bodies.find((b) => b.kind === 'resource' && b.survey >= 2)?.id ?? target),
        unloadId: 'base',
        repeat: false,
      };
    case 'HAUL':
      return {
        type,
        sourceId: facility?.kind === 'mine' ? facility.id : 'base',
        targetId:
          facility?.kind === 'mine'
            ? 'base'
            : (w.projects.find((p) => p.id === id)?.id ?? facility?.id ?? 'colony'),
        cargoKind: facility?.kind === 'mine' ? 'materials' : 'supplies',
        amount: 20,
        route: 'safe',
        repeat: false,
      };
    case 'ATTACK':
    case 'DISABLE':
    case 'DRIVE_OFF':
    case 'INTERCEPT':
    case 'SHADOW':
      return { type, targetId: id || w.contacts[0]?.id || '' };
    case 'ESCORT':
      return { type, targetId: selection?.type === 'ship' ? id : (w.ships[0]?.id ?? '') };
    case 'PATROL':
      return {
        type,
        targetId: facility?.owner === 'starfleet' ? facility.id : 'colony',
        duration: 60,
      };
    case 'REARM':
      return { type, targetId: 'base', load: { photon: 4, quantum: 0 } };
    case 'REFIT':
      return { type, targetId: 'base', moduleId: 'expandedCargo', remove: false };
    case 'RECOVER':
      return { type, targetId: id || w.wrecks[0]?.id || '' };
    default:
      return { type, targetId: facility?.owner === 'starfleet' ? facility.id : 'base' };
  }
}
export function OrderComposer({
  world,
  request,
  command,
  onClose,
}: {
  world: Snapshot;
  request: ComposerRequest;
  command: CommandSender;
  onClose: () => void;
}) {
  const [action, setAction] = useState<Action>(request.action),
    [shipIds, setShipIds] = useState<string[]>([
      world.ships.find(
        (s) =>
          s.id ===
          (request.shipId ??
            (request.action.type === 'EXPLORE' || request.action.type === 'SURVEY'
              ? 'verity'
              : request.action.type === 'HAUL'
                ? 'meridian'
                : 'vigil')),
      )?.id ??
        world.ships[0]?.id ??
        '',
    ]),
    [mode, setMode] = useState<'REPLACE' | 'QUEUE' | 'INTERRUPT'>('REPLACE');
  const update = (patch: Partial<Action>) => setAction((a) => ({ ...a, ...patch }) as Action);
  const ships = world.ships.filter((s) => shipIds.includes(s.id)),
    inventory = [
      ...world.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0),
      ...world.projects.filter((p) => !p.complete),
    ];
  const targets =
    action.type === 'SURVEY'
      ? [...world.systems, ...world.bodies]
      : action.type === 'MINE'
        ? world.bodies.filter((b) => b.kind === 'resource')
        : action.type === 'RECOVER'
          ? world.wrecks
          : action.type === 'ESCORT'
            ? world.ships
            : ['ATTACK', 'DISABLE', 'DRIVE_OFF', 'SHADOW', 'INTERCEPT'].includes(action.type)
              ? [...world.contacts, ...world.locations.filter((l) => l.owner !== 'starfleet')]
              : inventory;
  const dest = 'targetId' in action ? inventory.find((l) => l.id === action.targetId) : undefined;
  const origin =
    action.type === 'HAUL' ? inventory.find((l) => l.id === action.sourceId) : undefined;
  const firstLeg =
    action.type === 'HAUL' && ships[0] && origin
      ? routeEstimate(world, ships[0], origin, action.route)
      : null;
  const secondLeg =
    action.type === 'HAUL' && ships[0] && dest && origin
      ? routeEstimate(world, { ...ships[0], x: origin.x, y: origin.y }, dest, action.route)
      : null;
  const estimate =
    firstLeg && secondLeg
      ? {
          ...secondLeg,
          eta: firstLeg.eta + secondLeg.eta - 4,
          distance: firstLeg.distance + secondLeg.distance,
          unknownDistance: firstLeg.unknownDistance + secondLeg.unknownDistance,
        }
      : null;
  return (
    <LcarsDialog
      title="ADMIRAL DIRECTIVE"
      label="Admiral 指令"
      className="order-composer"
      onClose={onClose}
    >
      <LcarsTextBar>INTENT / FINAL COMMAND AUTHORITY</LcarsTextBar>
      <div className="composer-grid">
        <LcarsField>
          ACTIVITY
          <select
            aria-label="指令类型"
            value={action.type}
            onChange={(e) => setAction(defaultAction(e.target.value as Action['type'], world))}
          >
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </LcarsField>
        <LcarsField>
          COMMAND MODE
          <select
            aria-label="提交模式"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option>REPLACE</option>
            <option>QUEUE</option>
            <option>INTERRUPT</option>
          </select>
        </LcarsField>
        {'targetId' in action && (
          <LcarsField>
            TARGET
            <select
              aria-label="指令目标"
              value={action.targetId}
              onChange={(e) => update({ targetId: e.target.value })}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {'name' in t ? (t.name ?? t.id) : t.id}
                </option>
              ))}
            </select>
          </LcarsField>
        )}
        {action.type === 'EXPLORE' && (
          <LcarsField>
            UNKNOWN SECTOR
            <select
              aria-label="探索星区"
              value={sectorId(action.sector)}
              onChange={(e) => {
                const c = frontierSectors(world.sectors).find(
                  (c) => sectorId(c) === e.target.value,
                );
                if (c) update({ sector: c });
              }}
            >
              {frontierSectors(world.sectors).map((c) => (
                <option key={sectorId(c)} value={sectorId(c)}>
                  UNKNOWN {c.q}/{c.r}
                </option>
              ))}
            </select>
          </LcarsField>
        )}
        {(action.type === 'EXPLORE' || action.type === 'SURVEY') && (
          <LcarsField>
            SURVEY APPROACH
            <select
              aria-label="调查方式"
              value={action.approach}
              onChange={(e) => update({ approach: e.target.value as 'remote' | 'close' })}
            >
              <option value="remote">REMOTE SCAN / 安全测绘</option>
              <option value="close">CLOSE SURVEY / 现场调查</option>
            </select>
          </LcarsField>
        )}
        {action.type === 'SURVEY' && (
          <LcarsField>
            <input
              aria-label="Deep Scan"
              type="checkbox"
              checked={action.deep}
              onChange={(e) => update({ deep: e.target.checked })}
            />
            DEEP SCAN / 隐藏异常
          </LcarsField>
        )}
        {action.type === 'MINE' && (
          <>
            <LcarsField>
              UNLOAD AT
              <select
                aria-label="采矿卸货点"
                value={action.unloadId}
                onChange={(e) => update({ unloadId: e.target.value })}
              >
                {inventory.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </LcarsField>
            <LcarsField>
              <input
                type="checkbox"
                aria-label="循环采矿"
                checked={action.repeat}
                onChange={(e) => update({ repeat: e.target.checked })}
              />
              持续采集及卸货
            </LcarsField>
          </>
        )}
        {action.type === 'HAUL' && (
          <>
            <LcarsField>
              ORIGIN
              <select
                aria-label="货运起点"
                value={action.sourceId}
                onChange={(e) => update({ sourceId: e.target.value })}
              >
                {inventory.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </LcarsField>
            <LcarsField>
              CARGO
              <select
                aria-label="货物种类"
                value={action.cargoKind}
                onChange={(e) => update({ cargoKind: e.target.value as typeof action.cargoKind })}
              >
                {['materials', 'supplies', 'photon', 'quantum', 'specialFinds'].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </LcarsField>
            <LcarsField>
              AMOUNT
              <input
                aria-label="货物数量"
                type="number"
                min="1"
                value={action.amount}
                onChange={(e) => update({ amount: Number(e.target.value) })}
              />
            </LcarsField>
            <LcarsField>
              ROUTE
              <select
                aria-label="航线"
                value={action.route}
                onChange={(e) => update({ route: e.target.value as typeof action.route })}
              >
                <option value="safe">SAFE / 防御航道</option>
                <option value="direct">DIRECT / 直接航线</option>
                <option value="risky">RISKY / 高速危险航段</option>
              </select>
            </LcarsField>
            <LcarsField>
              <input
                type="checkbox"
                aria-label="循环货运"
                checked={action.repeat}
                onChange={(e) => update({ repeat: e.target.checked })}
              />
              循环货运 / Logistics
            </LcarsField>
            {estimate && (
              <p>
                ETA {estimate.eta}m · {estimate.risk} ·{' '}
                {estimate.unknownDistance > 0.01
                  ? '未知航段约 ' +
                    Math.round((estimate.unknownDistance / estimate.distance) * 100) +
                    '% / 风险不确定'
                  : '航段已测绘 / 接触情报仍可能变化'}
              </p>
            )}
          </>
        )}
        {action.type === 'PATROL' && (
          <LcarsField>
            DURATION
            <input
              aria-label="巡逻时间"
              type="number"
              value={action.duration}
              onChange={(e) => update({ duration: Number(e.target.value) })}
            />
          </LcarsField>
        )}
        {action.type === 'DISABLE' && (
          <LcarsField>
            TARGETING
            <select
              aria-label="禁用子系统"
              value={action.subsystem ?? 'suppression'}
              onChange={(e) =>
                setAction({
                  ...action,
                  subsystem:
                    e.target.value === 'suppression'
                      ? undefined
                      : (e.target.value as 'engines' | 'weapons'),
                })
              }
            >
              <option value="suppression">广域推进压制</option>
              <option value="engines">ENGINES / Precision Targeting</option>
              <option value="weapons">WEAPONS / Precision Targeting</option>
            </select>
          </LcarsField>
        )}
        {action.type === 'REARM' &&
          (['photon', 'quantum'] as const).map((k) => (
            <LcarsField key={k}>
              {k.toUpperCase()}
              <input
                aria-label={'装载 ' + k}
                type="number"
                min="0"
                value={action.load[k]}
                onChange={(e) => update({ load: { ...action.load, [k]: Number(e.target.value) } })}
              />
            </LcarsField>
          ))}
        {action.type === 'REFIT' && (
          <>
            <LcarsField>
              MODULE
              <select
                aria-label="安装模块"
                value={action.moduleId}
                onChange={(e) => update({ moduleId: e.target.value as ModuleId })}
              >
                {Object.entries(MODULES).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.label} · {m.cost.credits}C / {m.cost.materials}M / {m.cost.specialFinds}F
                  </option>
                ))}
              </select>
            </LcarsField>
            <p>{MODULES[action.moduleId].description}</p>
            <LcarsField>
              <input
                type="checkbox"
                aria-label="拆除模块"
                checked={action.remove}
                onChange={(e) => update({ remove: e.target.checked })}
              />
              拆除 / 消费与货舱校验
            </LcarsField>
          </>
        )}
        {action.type === 'MOVE' &&
          (['x', 'y'] as const).map((k) => (
            <LcarsField key={k}>
              {k.toUpperCase()}
              <input
                aria-label={'坐标 ' + k}
                type="number"
                value={action.point[k]}
                onChange={(e) =>
                  update({ point: { ...action.point, [k]: Number(e.target.value) } })
                }
              />
            </LcarsField>
          ))}
      </div>
      <LcarsTextBar>FLEET / ALL OWNED VESSELS</LcarsTextBar>
      <div className="asset-list">
        {world.ships.map((s) => (
          <LcarsField key={s.id}>
            <input
              type="checkbox"
              aria-label={'分配 ' + s.id}
              checked={shipIds.includes(s.id)}
              onChange={(e) =>
                setShipIds((ids) =>
                  e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                )
              }
            />
            {s.name} · {s.current?.action.type ?? 'AVAILABLE'} · CARGO {Math.floor(cargoUsed(s))}/
            {capabilities(s).cargo}
          </LcarsField>
        ))}
      </div>
      <p className="muted">
        {mode === 'REPLACE'
          ? '替换当前、挂起及排队指令；货物与损伤保留'
          : mode === 'QUEUE'
            ? '当前指令结束后按顺序执行；持续命令需取消或替换'
            : '临时行动结束后自动接续原指令；目标失效会报告'}
        。
      </p>
      <div className="dialog-actions">
        <LcarsButton
          onClick={async () => {
            const r = await command({ type: 'issueDirective', shipIds, mode, action });
            if (r.ok) onClose();
          }}
        >
          下达 Admiral 指令
        </LcarsButton>
        <LcarsButton tone="secondary" onClick={onClose}>
          取消
        </LcarsButton>
      </div>
    </LcarsDialog>
  );
}
