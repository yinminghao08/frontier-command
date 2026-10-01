import { useState } from 'react';
import type { OperationOrder, OrderKind, OrderSpec, Snapshot } from '../engine/types';
import { defaultOrder } from '../engine/data';
import { SHIP_CLASSES } from '../engine/definitions/ships';
import type { Selection } from '../StrategicMap';
import type { CommandSender } from './types';
export const KIND = { defense: '战斗／防御', transport: '运输', explore: '探索／侦察' };
export const PHASE = {
  preparing: '准备／装载',
  outbound: '前往目标',
  decision: '等待决策',
  working: '执行中',
  returning: '返航',
  complete: '已归档',
};
export function OrderComposer({
  world,
  kind,
  selection,
  existing,
  onClose,
  command,
}: {
  world: Snapshot;
  kind: OrderKind;
  selection: Selection | null;
  existing?: OperationOrder;
  onClose: () => void;
  command: CommandSender;
}) {
  const [spec, setSpec] = useState<OrderSpec>(() => {
    if (existing) return structuredClone(existing);
    const s = defaultOrder(kind);
    if (selection?.type === 'point' && kind === 'explore') s.objective = { ...selection };
    if (selection?.type === 'location') {
      const l = world.locations.find((l) => l.id === selection.id);
      if (
        l &&
        ((kind === 'transport' && ['colony', 'outpost', 'base', 'mine'].includes(l.kind)) ||
          (kind === 'defense' && ['colony', 'outpost', 'base', 'mine'].includes(l.kind)) ||
          kind === 'explore')
      )
        s.objective = { type: selection.type as 'location' | 'ship' | 'contact', id: selection.id };
    }
    if (selection?.type === 'contact' && kind !== 'transport')
      s.objective = { type: selection.type as 'location' | 'ship' | 'contact', id: selection.id };
    if (selection?.type === 'ship' && kind === 'defense')
      s.objective = { type: selection.type as 'location' | 'ship' | 'contact', id: selection.id };
    return s;
  });
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<OrderSpec>) => setSpec((s) => ({ ...s, ...p }));
  const objectiveKey =
    spec.objective.type === 'point' ? 'point' : spec.objective.type + ':' + spec.objective.id;
  const options = [
    ...world.locations
      .filter(
        (l) =>
          spec.kind === 'explore' ||
          (l.regionId === 'federation' && ['base', 'colony', 'outpost', 'mine'].includes(l.kind)),
      )
      .map((l) => ({ value: 'location:' + l.id, label: l.name })),
    ...(spec.kind === 'defense'
      ? world.ships.map((s) => ({ value: 'ship:' + s.id, label: '保护 ' + s.name }))
      : []),
    ...(spec.kind !== 'transport'
      ? world.contacts.map((c) => ({
          value: 'contact:' + c.id,
          label: c.name ?? '未识别接触 ' + c.id,
        }))
      : []),
  ];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = existing
      ? await command({
          type: 'updateOrder',
          orderId: existing.id,
          changes: {
            priority: spec.priority,
            roe: spec.roe,
            border: spec.border,
            retreat: spec.retreat,
            route: spec.route,
            ...(spec.kind === 'defense'
              ? { objective: spec.objective, shipIds: spec.shipIds }
              : {}),
            ...(spec.kind === 'explore' && existing.phase !== 'working'
              ? { approach: spec.approach }
              : {}),
          },
        })
      : await command({ type: 'createOrder', spec });
    setBusy(false);
    if (result.ok) onClose();
  };
  return (
    <div className="composer-backdrop">
      <section
        className="order-composer"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? '修改行动' : '创建行动'}
      >
        <div className="panel-heading">
          <div>
            <small>ADMIRAL'S ORDERS</small>
            <h2>{existing ? '修改行动' : KIND[spec.kind]}</h2>
          </div>
          <button onClick={onClose} aria-label="关闭行动编辑">
            ×
          </button>
        </div>
        <form noValidate onSubmit={submit}>
          <p className="muted">
            {spec.kind === 'defense'
              ? '选择保护目标与交战规则；拦截必须确认驱离或击毁。'
              : spec.kind === 'transport'
                ? '预留真实库存，装货、航行、卸货后结算。安全路线依据当前已知风险。'
                : '调查未知区域与异常；扫描真实消耗 Core，近距采样提高精度并承担辐射及暴露风险。'}
          </p>
          <label>
            Objective / 目标
            <select
              aria-label="行动目标"
              value={objectiveKey}
              disabled={!!existing && spec.kind !== 'defense'}
              onChange={(e) => {
                const [type, id] = e.target.value.split(':');
                if (type !== 'point')
                  patch({ objective: { type: type as 'location' | 'ship' | 'contact', id } });
              }}
            >
              {spec.objective.type === 'point' && (
                <option value="point">
                  未知区域 ({spec.objective.x}, {spec.objective.y})
                </option>
              )}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Assets / 执行舰船 {spec.kind === 'defense' ? '· 可多舰' : '· 单舰'}</legend>
            {world.ships.map((s) => {
              const d = SHIP_CLASSES[s.classId],
                allowed = (s.status === 'docked' && !s.orderId) || s.orderId === existing?.id;
              return (
                <label className="ship-option" key={s.id}>
                  <input
                    aria-label={'分配 ' + d.name}
                    type="checkbox"
                    checked={spec.shipIds.includes(s.id)}
                    disabled={!allowed || (!!existing && spec.kind !== 'defense')}
                    onChange={(e) =>
                      patch({
                        shipIds: e.target.checked
                          ? spec.kind === 'defense'
                            ? [...spec.shipIds, s.id]
                            : [s.id]
                          : spec.shipIds.filter((id) => id !== s.id),
                      })
                    }
                  />
                  <span>
                    <b>{d.name}</b>
                    <small>
                      {s.name.split(' / ')[1]} · 货舱 {d.cargo} · 科学 {d.science} ·{' '}
                      {allowed ? '可用' : '忙碌'}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="form-grid">
            <label>
              Priority
              <select
                value={spec.priority}
                onChange={(e) => patch({ priority: e.target.value as OrderSpec['priority'] })}
              >
                <option value="normal">常规</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </label>
            <label>
              ROE
              <select
                aria-label="交战规则"
                value={spec.roe}
                onChange={(e) => patch({ roe: e.target.value as OrderSpec['roe'] })}
              >
                {['HOLD FIRE', 'RETURN FIRE', 'ENGAGE HOSTILES', 'WEAPONS FREE'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            跨境授权
            <select
              aria-label="跨境授权"
              value={spec.border}
              onChange={(e) => patch({ border: e.target.value as OrderSpec['border'] })}
            >
              <option value="federation">仅联邦空间</option>
              <option value="neutral">授权进入中立区</option>
              <option value="romulan">授权进入罗慕兰空间</option>
            </select>
          </label>
          {spec.border !== 'federation' && (
            <p className="warning">跨境会暴露舰队并可能引发罗慕兰响应；授权不会解除交战规则。</p>
          )}
          {spec.kind === 'defense' && !existing && (
            <label>
              防御窗口（游戏分钟）
              <input
                aria-label="防御时长"
                type="number"
                min="10"
                max="180"
                value={spec.duration}
                onChange={(e) => patch({ duration: Number(e.target.value) })}
              />
            </label>
          )}
          {spec.kind === 'transport' && (
            <>
              <label>
                起点
                <select
                  aria-label="运输起点"
                  value={spec.sourceId}
                  disabled={!!existing}
                  onChange={(e) => patch({ sourceId: e.target.value })}
                >
                  {world.locations
                    .filter(
                      (l) =>
                        l.regionId === 'federation' &&
                        ['base', 'colony', 'outpost', 'mine'].includes(l.kind),
                    )
                    .map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  货物
                  <select
                    aria-label="货物类型"
                    value={spec.cargoKind}
                    disabled={!!existing}
                    onChange={(e) => patch({ cargoKind: e.target.value as OrderSpec['cargoKind'] })}
                  >
                    <option value="supplies">补给</option>
                    <option value="medical">医疗物资</option>
                    <option value="materials">维修材料</option>
                  </select>
                </label>
                <label>
                  数量
                  <input
                    aria-label="货物数量"
                    type="number"
                    min="1"
                    max={Math.max(
                      1,
                      ...world.ships
                        .filter((s) => spec.shipIds.includes(s.id))
                        .map((s) => SHIP_CLASSES[s.classId].cargo),
                    )}
                    disabled={!!existing}
                    value={spec.amount}
                    onChange={(e) => patch({ amount: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="muted">
                起点可用：
                {(() => {
                  const l = world.locations.find((l) => l.id === spec.sourceId);
                  return l ? l.stock[spec.cargoKind] - l.reserved[spec.cargoKind] : 0;
                })()}{' '}
                · 超容量或超库存命令会由引擎拒绝。
              </p>
            </>
          )}
          <label>
            航线
            <select
              aria-label="航线"
              value={spec.route}
              onChange={(e) => patch({ route: e.target.value as 'safe' | 'fast' })}
            >
              <option value="safe">安全 · 绕开已知威胁／异常</option>
              <option value="fast">快速 · 直达目标</option>
            </select>
          </label>
          {spec.kind === 'explore' && (
            <label>
              默认调查方案
              <select
                value={spec.approach}
                disabled={existing?.phase === 'working'}
                onChange={(e) => patch({ approach: e.target.value as 'remote' | 'close' })}
              >
                <option value="remote">远距扫描</option>
                <option value="close">近距调查</option>
              </select>
            </label>
          )}
          <fieldset>
            <legend>Withdrawal / 自动撤退阈值（0 表示关闭）</legend>
            <div className="form-grid three">
              {(['hull', 'shield', 'core'] as const).map((key, i) => (
                <label key={key}>
                  {['Hull %', 'Shield %', 'Core %'][i]}
                  <input
                    aria-label={'撤退 ' + key}
                    type="number"
                    min="0"
                    max="90"
                    value={spec.retreat[key]}
                    onChange={(e) =>
                      patch({ retreat: { ...spec.retreat, [key]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={spec.retreat.emptyAmmo}
                onChange={(e) =>
                  patch({ retreat: { ...spec.retreat, emptyAmmo: e.target.checked } })
                }
              />
              鱼雷耗尽时撤退（装备鱼雷的舰型）
            </label>
          </fieldset>
          <button
            className="primary wide"
            type="submit"
            disabled={busy || spec.shipIds.length === 0}
          >
            {busy ? '提交中…' : existing ? '更新指令' : '授权派遣'}
          </button>
          {!spec.shipIds.length && <small className="muted">请选择执行舰船。</small>}
        </form>
      </section>
    </div>
  );
}
