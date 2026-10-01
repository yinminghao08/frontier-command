import { useState } from 'react';
import type { OperationOrder, Snapshot, OrderKind } from '../engine/types';
import { SHIP_CLASSES } from '../engine/definitions/ships';
import type { Selection } from '../StrategicMap';
import type { CommandSender } from './types';
import { KIND, PHASE } from './OrderComposer';
import { actionProgress } from './format';
export function Inspector({
  world,
  selection,
  select,
  command,
  create,
  edit,
}: {
  world: Snapshot;
  selection: Selection | null;
  select: (s: Selection) => void;
  command: CommandSender;
  create: (k: OrderKind) => void;
  edit: (o: OperationOrder) => void;
}) {
  if (!selection)
    return (
      <div>
        <h2>SECTOR INSPECTOR</h2>
        <p>选择地图上的舰船、地点或接触，查看状态并下达命令。</p>
      </div>
    );
  if (selection.type === 'point')
    return (
      <>
        <small>UNSURVEYED COORDINATES</small>
        <h2>未知区域</h2>
        <p>
          {selection.x}, {selection.y}
        </p>
        <button onClick={() => create('explore')}>创建侦察行动</button>
        <p className="muted">调查结果将保存在星图与档案中。</p>
      </>
    );
  if (selection.type === 'ship') {
    const s = world.ships.find((s) => s.id === selection.id);
    if (!s) return <p>舰船不可用。</p>;
    const d = SHIP_CLASSES[s.classId],
      o = world.orders.find((o) => o.id === s.orderId);
    const status = {
      docked: '停靠',
      mission: '执行行动',
      returning: '返航',
      repairing: '维修',
      rearming: '补充弹药',
    }[s.status];
    return (
      <>
        <small>FEDERATION / {d.name}</small>
        <h2>{s.name.split(' / ')[1]}</h2>
        <p>{s.name.split(' / ')[0]}</p>
        <span className="badge">{status}</span>
        {(
          [
            ['Hull', s.hull, d.hull],
            ['Shield', s.shield, d.shield],
            ['Core Power', s.core, d.core],
          ] as const
        ).map(([name, value, max]) => (
          <div className="meter" key={name}>
            <span>
              {name}
              <b>
                {Math.round(value)} / {max}
              </b>
            </span>
            <progress value={value} max={max} />
          </div>
        ))}
        <dl>
          <dt>Warp</dt>
          <dd>{d.warp}</dd>
          <dt>Sensors</dt>
          <dd>{d.sensors}</dd>
          <dt>恢复 / 游戏分钟</dt>
          <dd>
            Shield {d.shieldRegen} · Core {d.coreRegen}
          </dd>
          <dt>Photon / Quantum</dt>
          <dd>
            {s.photon} / {s.quantum}
          </dd>
          <dt>Cargo</dt>
          <dd>
            {Object.values(s.cargo).reduce((a, b) => a + b, 0)} / {d.cargo}
          </dd>
          <dt>Weapons</dt>
          <dd>{d.weapons.join(' / ')}</dd>
          <dt>当前行为</dt>
          <dd>{s.behavior}</dd>
        </dl>
        {o && (
          <button className="wide" onClick={() => select({ type: 'order', id: o.id })}>
            {o.id} · {PHASE[o.phase]}
          </button>
        )}
        <div className="button-grid">
          <button
            disabled={
              s.core < 12 ||
              s.scanUntil > world.time ||
              ['repairing', 'rearming'].includes(s.status)
            }
            title="消耗12能源，主动扫描12游戏分钟"
            onClick={() => command({ type: 'scan', shipId: s.id })}
          >
            主动扫描
          </button>
          <button
            disabled={!o || o.settled}
            onClick={() => command({ type: 'recall', shipId: s.id })}
          >
            撤退返航
          </button>
          <button
            disabled={s.status !== 'docked' || s.hull >= d.hull}
            title="消耗真实维修材料；库存不足时拒绝"
            onClick={() => command({ type: 'repair', shipId: s.id })}
          >
            维修
          </button>
        </div>
        {d.photon + d.quantum > 0 && (
          <RearmControls key={s.id} shipId={s.id} world={world} command={command} />
        )}
        {s.service > 0 && <p>保障阶段剩余 {Math.ceil(s.service)} 游戏分钟</p>}
        <p className="muted">
          LV1 确定性规则 AI · 指挥组执行高层命令。不可用操作需要停靠、能源或待执行行动。
        </p>
      </>
    );
  }
  if (selection.type === 'location') {
    const l = world.locations.find((l) => l.id === selection.id);
    if (!l) return <p>地点不存在。</p>;
    return (
      <>
        <small>{l.label}</small>
        <h2>{l.name}</h2>
        <p>
          {l.regionId.toUpperCase()} SPACE · ({l.x}, {l.y})
        </p>
        {l.regionId === 'romulan' ? (
          <p className="muted">公开星图位置；设施实时库存与防御状态未知。</p>
        ) : (
          <>
            <div className="meter">
              <span>
                设施完整度
                <b>
                  {Math.round(l.hull)} / {l.maxHull}
                </b>
              </span>
              <progress value={l.hull} max={l.maxHull} />
            </div>
            {l.maxShield > 0 && (
              <div className="meter">
                <span>
                  SHIELD{' '}
                  <b>
                    {Math.ceil(l.shield)} / {l.maxShield}
                  </b>
                </span>
                <progress value={l.shield} max={l.maxShield} />
              </div>
            )}
            <dl>
              {(['supplies', 'medical', 'materials'] as const).map((k, i) => (
                <div className="dl-row" key={k}>
                  <dt>{['补给', '医疗', '材料'][i]}</dt>
                  <dd>
                    {Math.floor(l.stock[k])} <small>预留 {l.reserved[k]}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {l.regionId === 'federation' && l.hull > 0 && l.hull < l.maxHull && (
          <button
            disabled={l.stock.materials - l.reserved.materials < 1}
            onClick={() => command({ type: 'repairFacility', locationId: l.id })}
          >
            消耗本地材料维修
          </button>
        )}
        {l.distress && <p className="warning">需要后勤或防御支援</p>}
        <p className="muted">
          {l.surveyed ? '已调查：已知异常风险可用于安全路线评估。' : '尚未完成科学调查。'}
        </p>
        {l.hull > 0 &&
          l.regionId === 'federation' &&
          ['base', 'colony', 'outpost', 'mine'].includes(l.kind) && (
            <div className="button-grid">
              <button onClick={() => create('transport')}>运输到此处</button>
              <button onClick={() => create('defense')}>保护设施</button>
            </div>
          )}
        <button className="wide" onClick={() => create('explore')}>
          调查此区域
        </button>
        {l.kind === 'base' && (
          <p className="muted">
            长程传感器覆盖290距离单位；不能必然识破隐形。基地提供材料维修与实物装弹；基地摧毁即
            COMMAND LOST。
          </p>
        )}
      </>
    );
  }
  if (selection.type === 'contact') {
    const c = world.contacts.find((c) => c.id === selection.id);
    if (!c)
      return (
        <>
          <h2>接触已失效</h2>
          <p>情报过期或已确认目标离场。历史报告保留在 ARCHIVE。</p>
        </>
      );
    return (
      <>
        <small>INTELLIGENCE / {c.level}</small>
        <h2>{c.name ?? '未识别亚空间接触'}</h2>
        <span className={'badge ' + (c.hostile ? 'danger' : '')}>
          {c.hostile ? '敌对接触' : '意图未确认'}
        </span>
        <p>{c.live ? '传感器当前观测' : 'LAST KNOWN POSITION'}</p>
        <dl>
          <dt>最后观测</dt>
          <dd>{Math.floor(world.time - c.lastSeen)} 游戏分钟前</dd>
          <dt>位置</dt>
          <dd>
            {Math.round(c.x)}, {Math.round(c.y)}
          </dd>
          <dt>阵营</dt>
          <dd>{c.factionId ?? 'UNKNOWN'}</dd>
          <dt>舰型</dt>
          <dd>{c.classId ? SHIP_CLASSES[c.classId].name : 'UNKNOWN'}</dd>
        </dl>
        {c.classId && c.hull !== undefined && c.shield !== undefined && (
          <>
            <div className="meter">
              <span>
                观测 Hull
                <b>
                  {Math.round(c.hull)} / {SHIP_CLASSES[c.classId].hull}
                </b>
              </span>
              <progress value={c.hull} max={SHIP_CLASSES[c.classId].hull} />
            </div>
            <div className="meter">
              <span>
                观测 Shield
                <b>
                  {Math.round(c.shield)} / {SHIP_CLASSES[c.classId].shield}
                </b>
              </span>
              <progress value={c.shield} max={SHIP_CLASSES[c.classId].shield} />
            </div>
          </>
        )}
        <div className="button-grid">
          <button onClick={() => create('explore')}>侦察／识别</button>
          <button onClick={() => create('defense')}>创建拦截</button>
        </div>
        <p className="muted">
          失去探测后位置不会更新，30游戏分钟后地图标记失效。未知接触不能直接开火。
        </p>
      </>
    );
  }
  if (selection.type === 'loss') {
    const l = world.losses.find((l) => l.shipId === selection.id);
    if (!l) return <p>没有该舰损档案。</p>;
    return (
      <>
        <small>ARCHIVE / VESSEL DESTROYED</small>
        <h2>{l.name}</h2>
        <p className="danger-text">PERMANENT LOSS</p>
        <dl>
          <dt>舰级</dt>
          <dd>{SHIP_CLASSES[l.classId].name}</dd>
          <dt>游戏分钟</dt>
          <dd>{l.tick / 10}</dd>
          <dt>原因</dt>
          <dd>{l.reason}</dd>
          <dt>损失货物</dt>
          <dd>{Object.values(l.cargo).reduce((a, b) => a + b, 0)}</dd>
          <dt>损失弹药</dt>
          <dd>
            {l.ammunition.photon} / {l.ammunition.quantum}
          </dd>
        </dl>
        <p className="muted">原规则操作者已撤销执行权限。此舰不能维修、装弹或再次派遣。</p>
      </>
    );
  }
  const o = world.orders.find((o) => o.id === selection.id);
  if (!o) return <p>行动记录已归档清理。</p>;
  return (
    <>
      <small>OPERATION / {o.id}</small>
      <h2>{KIND[o.kind]}</h2>
      <span className="badge">
        {PHASE[o.phase]}
        {o.held ? ' · 暂停执行' : ''}
      </span>
      <dl>
        <dt>Priority</dt>
        <dd>{o.priority}</dd>
        <dt>ROE</dt>
        <dd>{o.roe}</dd>
        <dt>跨境授权</dt>
        <dd>{o.border}</dd>
        <dt>航线</dt>
        <dd>{o.route === 'safe' ? '安全' : '快速'}</dd>
        <dt>执行时间</dt>
        <dd>{Math.floor(world.time - o.created)} 游戏分钟</dd>
        <dt>期限剩余</dt>
        <dd>{o.settled ? '已结算' : Math.max(0, Math.ceil(o.deadline - world.time)) + 'm'}</dd>
      </dl>
      <p className="muted">{actionProgress(world, o).text}</p>
      {actionProgress(world, o).fraction !== null && (
        <progress aria-label="行动进度" max={1} value={actionProgress(world, o).fraction!} />
      )}
      {o.shipIds.map((id) => {
        const s = world.ships.find((s) => s.id === id);
        const loss = world.losses.find((l) => l.shipId === id);
        return (
          <button
            className="wide"
            key={id}
            onClick={() => select({ type: s ? 'ship' : 'loss', id })}
          >
            {s?.name ?? loss?.name ?? id}
            {!s ? ' / DESTROYED' : ''}
          </button>
        );
      })}
      {o.phase === 'decision' && (
        <div className="decision-box">
          <h3>调查决策</h3>
          <p>近距耗时更长、采样精度更高，也承担辐射和暴露风险。继续20分钟未决则执行预设方案。</p>
          <button
            onClick={() => command({ type: 'investigate', orderId: o.id, approach: 'remote' })}
          >
            远距扫描 · 保守
          </button>
          <button
            onClick={() => command({ type: 'investigate', orderId: o.id, approach: 'close' })}
          >
            近距调查 · 高精度
          </button>
        </div>
      )}
      {o.result && (
        <p className="result-box">
          {o.outcome} · {o.result}
        </p>
      )}
      {!o.settled && (
        <div className="button-grid">
          <button onClick={() => edit(o)}>修改指令</button>
          <button
            onClick={() => command({ type: o.held ? 'resumeOrder' : 'holdOrder', orderId: o.id })}
          >
            {o.held ? '恢复行动' : '暂停行动'}
          </button>
          <button onClick={() => command({ type: 'cancelOrder', orderId: o.id })}>
            取消并返航
          </button>
        </div>
      )}
      <p className="muted">
        {o.phase === 'returning'
          ? '结果已结算，舰船抵港后解除占用。'
          : o.phase === 'complete'
            ? '行动闭环完成，可再次创建新命令。'
            : '行动与地图状态均来自同一引擎快照。'}
      </p>
    </>
  );
}

function RearmControls({
  shipId,
  world,
  command,
}: {
  shipId: string;
  world: Snapshot;
  command: CommandSender;
}) {
  const s = world.ships.find((s) => s.id === shipId)!,
    d = SHIP_CLASSES[s.classId];
  const max = (k: 'photon' | 'quantum') =>
    Math.max(
      0,
      Math.min(d[k] - s[k] - s.rearm[k], world.armory.stock[k] - world.armory.reserved[k]),
    );
  const [load, setLoad] = useState({ photon: max('photon'), quantum: max('quantum') });
  return (
    <fieldset disabled={s.status !== 'docked' || world.status !== 'active'}>
      <legend>ARMORY / 实物装弹</legend>
      <div className="form-grid">
        {(['photon', 'quantum'] as const)
          .filter((k) => d[k] > 0)
          .map((k) => (
            <label key={k}>
              {k.toUpperCase()}
              <input
                aria-label={'装弹 ' + k}
                type="number"
                min="0"
                max={max(k)}
                value={load[k]}
                onChange={(e) => setLoad({ ...load, [k]: Number(e.target.value) })}
              />
              <small>
                可装 {max(k)} · 基地可用 {world.armory.stock[k] - world.armory.reserved[k]}
              </small>
            </label>
          ))}
      </div>
      <button
        disabled={load.photon + load.quantum <= 0}
        onClick={() => command({ type: 'rearm', shipId, load })}
      >
        授权装弹
      </button>
      <small>预留 → 按发转入弹舱；未装部分不会凭空生成。</small>
    </fieldset>
  );
}
