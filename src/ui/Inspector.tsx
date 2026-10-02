import { useState } from 'react';
import type { Snapshot, Action, FacilityKind } from '../engine/types';
import type { Selection } from '../StrategicMap';
import type { CommandSender } from './types';
import type { ComposerRequest } from './OrderComposer';
import { defaultAction } from './OrderComposer';
import { LcarsButton, LcarsField, LcarsMeter, LcarsTextBar } from './components/Lcars';
import { capabilities, cargoUsed } from '../engine/capabilities';
import { FACILITIES, MODULES } from '../engine/definitions/progression';
import { ACTION_LABELS, actionProgress } from './format';
function Rename({ id, name, command }: { id: string; name: string; command: CommandSender }) {
  const [value, setValue] = useState(name);
  return (
    <div className="inline-actions">
      <LcarsField>
        DISPLAY NAME
        <input
          aria-label="显示名称"
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
        />
      </LcarsField>
      <LcarsButton onClick={() => command({ type: 'renameEntity', entityId: id, name: value })}>
        保存名称
      </LcarsButton>
    </div>
  );
}
export function Inspector({
  world,
  selection,
  select,
  command,
  create,
}: {
  world: Snapshot;
  selection: Selection | null;
  select: (s: Selection) => void;
  command: CommandSender;
  create: (r: ComposerRequest) => void;
}) {
  const [buildKind, setBuildKind] = useState<Exclude<FacilityKind, 'base'>>('mine'),
    [projectName, setProjectName] = useState(''),
    [freighter, setFreighter] = useState('meridian');
  const launch = (type: Action['type'], shipId?: string) =>
    create({ action: defaultAction(type, world, selection), shipId });
  if (!selection) return <p>选择舰船、设施、恒星系或 UNKNOWN SPACE，下达 Admiral 意图。</p>;
  if (selection.type === 'point' || selection.type === 'sector')
    return (
      <>
        <LcarsTextBar>
          {selection.type === 'sector'
            ? 'SECTOR ' + selection.q + '/' + selection.r
            : 'WORLD COORDINATES'}
        </LcarsTextBar>
        <p>持续边疆 · 未知区域可测绘，世界没有固定地图尽头。</p>
        <LcarsButton onClick={() => launch('EXPLORE')}>Explore Sector</LcarsButton>
        <LcarsButton onClick={() => launch('MOVE')}>Move</LcarsButton>
      </>
    );
  if (selection.type === 'ship') {
    const s = world.ships.find((s) => s.id === selection.id);
    if (!s) return <p>舰船已进入永久损失档案。</p>;
    const c = capabilities(s);
    return (
      <>
        <LcarsTextBar>{s.name}</LcarsTextBar>
        <p>{c.name} · FINAL ADMIRAL AUTHORITY</p>
        <LcarsMeter label="HULL" value={s.hull} max={c.hull} />
        <LcarsMeter label="SHIELD" value={s.shield} max={c.shield} />
        <LcarsMeter label="CORE" value={s.core} max={c.core} />
        <p>
          ENGINES {Math.round(s.engines)} / WEAPONS {Math.round(s.weapons)} · PHOTON {s.photon} /
          QUANTUM {s.quantum}
        </p>
        <LcarsTextBar>CURRENT / QUEUE / SUSPENDED</LcarsTextBar>
        <p>
          {s.current ? ACTION_LABELS[s.current.action.type] : 'AVAILABLE'} ·{' '}
          {actionProgress(world, s).text}
        </p>
        {s.queue.map((d) => (
          <p key={d.id}>QUEUED · {ACTION_LABELS[d.action.type]}</p>
        ))}
        {s.suspended.map((d) => (
          <p key={d.id}>SUSPENDED · {ACTION_LABELS[d.action.type]} / 保留进度</p>
        ))}
        <div className="inline-actions">
          <LcarsButton onClick={() => launch('MOVE', s.id)}>新指令 / 改令</LcarsButton>
          <LcarsButton
            tone="danger"
            onClick={() => command({ type: 'cancelDirective', shipId: s.id })}
          >
            取消全部指令
          </LcarsButton>
          <LcarsButton onClick={() => launch('RETREAT', s.id)}>Retreat</LcarsButton>
        </div>
        <LcarsTextBar>
          CARGO / {Math.floor(cargoUsed(s))} / {c.cargo}
        </LcarsTextBar>
        {Object.entries(s.cargo).map(([k, v]) => (
          <p key={k}>
            {k.toUpperCase()} {Math.floor(v)}
          </p>
        ))}
        <LcarsButton onClick={() => launch('UNLOAD', s.id)}>Unload / 入库</LcarsButton>
        <LcarsTextBar>
          MODULES / {s.modules.length} / {c.moduleSlots}
        </LcarsTextBar>
        {s.modules.map((k) => (
          <p key={k}>{MODULES[k].label}</p>
        ))}
        <div className="inline-actions">
          {(['REPAIR', 'REARM', 'REFIT'] as const).map((t) => (
            <LcarsButton key={t} onClick={() => launch(t, s.id)}>
              {ACTION_LABELS[t]}
            </LcarsButton>
          ))}
        </div>
        <LcarsField>
          AUTONOMOUS ROE
          <select
            aria-label="自主交战规则"
            value={s.standing.roe}
            onChange={(e) =>
              command({
                type: 'standingOrders',
                shipId: s.id,
                roe: e.target.value as typeof s.standing.roe,
                retreatHull: s.standing.retreatHull,
              })
            }
          >
            <option>HOLD FIRE</option>
            <option>RETURN FIRE</option>
            <option>ENGAGE HOSTILES</option>
          </select>
        </LcarsField>
        <p className="muted">ROE 只约束自主开火；Admiral 明确攻击始终优先。</p>
        <Rename key={s.id} id={s.id} name={s.name} command={command} />
      </>
    );
  }
  if (selection.type === 'body' || selection.type === 'system') {
    const b = world.bodies.find((b) => b.id === selection.id),
      sys = world.systems.find((s) => s.id === selection.id),
      entity = b ?? sys;
    if (!entity) return <p>当前情报不可用。</p>;
    return (
      <>
        <LcarsTextBar>{entity.name}</LcarsTextBar>
        <p>
          {b?.kind.toUpperCase() ?? 'STAR SYSTEM'} · SURVEY {entity.survey}/2
        </p>
        {b && (
          <p>
            {b.survey >= 2
              ? b.kind === 'resource'
                ? 'RESERVES ' + Math.floor(b.remaining) + ' · RICHNESS ' + b.richness.toFixed(2)
                : b.kind === 'planet'
                  ? 'HABITABLE ' + (b.habitable ? 'YES' : 'NO')
                  : 'ANOMALY / ' + (b.hidden ? 'DEEP' : 'NORMAL')
              : '远距轮廓，需要近距确认'}{' '}
            · HAZARD {b.survey >= 2 ? b.hazard.toFixed(2) : 'UNKNOWN'}
          </p>
        )}
        <div className="inline-actions">
          <LcarsButton onClick={() => launch('SURVEY')}>Remote / Close Survey</LcarsButton>
          {b?.kind === 'resource' && (
            <LcarsButton onClick={() => launch('MINE')}>Mine / Extraction</LcarsButton>
          )}
        </div>
        {sys &&
          sys.bodyIds.map((id) => {
            const child = world.bodies.find((b) => b.id === id);
            return (
              child && (
                <LcarsButton
                  key={id}
                  shape="rail"
                  className="record-row"
                  onClick={() => select({ type: 'body', id })}
                >
                  {child.name} / {child.kind}
                </LcarsButton>
              )
            );
          })}
        <LcarsTextBar>FRONTIER CONSTRUCTION</LcarsTextBar>
        <LcarsField>
          FACILITY
          <select
            aria-label="设施类型"
            value={buildKind}
            onChange={(e) => setBuildKind(e.target.value as typeof buildKind)}
          >
            <option value="mine">MINE</option>
            <option value="outpost">OUTPOST</option>
            <option value="colony">COLONY</option>
            <option value="platform">DEFENSE PLATFORM</option>
          </select>
        </LcarsField>
        <LcarsField>
          FACILITY NAME
          <input
            aria-label="新设施名称"
            value={projectName}
            placeholder={entity.name + ' ' + buildKind}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </LcarsField>
        <p>
          {FACILITIES[buildKind].cost.credits} Credits · {FACILITIES[buildKind].cost.materials}{' '}
          Materials · {FACILITIES[buildKind].cost.supplies} Supplies / 必须运到现场
        </p>
        <LcarsButton
          onClick={() =>
            command({
              type: 'startConstruction',
              siteId: entity.id,
              kind: buildKind,
              name: projectName.trim() || entity.name + ' ' + buildKind,
            })
          }
        >
          建立现场建设项目
        </LcarsButton>
        {(!b || b.kind === 'planet') && (
          <Rename key={entity.id} id={entity.id} name={entity.name} command={command} />
        )}
      </>
    );
  }
  if (selection.type === 'project') {
    const p = world.projects.find((p) => p.id === selection.id);
    if (!p) return <p>项目不可用。</p>;
    return (
      <>
        <LcarsTextBar>{p.name}</LcarsTextBar>
        <p>{p.complete ? 'COMPLETE' : 'WAITING FOR PHYSICAL CARGO'}</p>
        <p>
          MATERIALS {Math.floor(p.stock.materials)} / {p.cost.materials} · SUPPLIES{' '}
          {Math.floor(p.stock.supplies)} / {p.cost.supplies}
        </p>
        <LcarsMeter label="CONSTRUCTION" value={p.work} max={p.duration} />
        <LcarsField>
          FREIGHTER
          <select
            aria-label="建设货运舰"
            value={freighter}
            onChange={(e) => setFreighter(e.target.value)}
          >
            {world.ships.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </LcarsField>
        <LcarsButton
          disabled={p.complete}
          onClick={async () => {
            const s = world.ships.find((s) => s.id === freighter);
            if (!s) return;
            const capacity = capabilities(s).cargo;
            let first = true;
            for (const [kind, needed] of [
              ['materials', Math.max(0, Math.ceil(p.cost.materials - p.stock.materials))],
              ['supplies', Math.max(0, Math.ceil(p.cost.supplies + 12 - p.stock.supplies))],
            ] as const) {
              for (let left = needed; left > 0; left -= capacity) {
                const r = await command({
                  type: 'issueDirective',
                  shipIds: [s.id],
                  mode: first ? 'REPLACE' : 'QUEUE',
                  action: {
                    type: 'HAUL',
                    sourceId: 'base',
                    targetId: p.id,
                    cargoKind: kind,
                    amount: Math.min(capacity, left),
                    route: 'safe',
                    repeat: false,
                  },
                });
                if (!r.ok) return;
                first = false;
              }
            }
          }}
        >
          安排建设物资 / 分批真实货运
        </LcarsButton>
        <LcarsButton onClick={() => launch('HAUL')}>自定义运输</LcarsButton>
      </>
    );
  }
  if (selection.type === 'location') {
    const l = world.locations.find((l) => l.id === selection.id);
    if (!l) return <p>设施不可见。</p>;
    return (
      <>
        <LcarsTextBar>{l.name}</LcarsTextBar>
        <p>
          {l.kind.toUpperCase()} / {l.owner.toUpperCase()} {l.distress ? ' / DISTRESS' : ''}
        </p>
        <LcarsMeter label="HULL" value={l.hull} max={l.maxHull} />
        <LcarsMeter label="SHIELD" value={l.shield} max={l.maxShield} />
        <p>PHASER RANGE {FACILITIES[l.kind].range} · 自卫火控在线</p>
        {l.owner === 'starfleet' ? (
          <>
            <LcarsTextBar>ACTUAL STOCK</LcarsTextBar>
            {Object.entries(l.stock).map(([k, v]) => (
              <p key={k}>
                {k.toUpperCase()} {Math.floor(v)}
              </p>
            ))}
            <div className="inline-actions">
              <LcarsButton onClick={() => launch('HAUL')}>Transport / Logistics</LcarsButton>
              <LcarsButton onClick={() => launch('PATROL')}>Patrol / Security</LcarsButton>
              <LcarsButton onClick={() => command({ type: 'repairFacility', locationId: l.id })}>
                使用本地材料维修
              </LcarsButton>
            </div>
            <Rename key={l.id} id={l.id} name={l.name} command={command} />
          </>
        ) : (
          <>
            <p>敌方库存与意图未知</p>
            <LcarsButton tone="danger" onClick={() => launch('ATTACK')}>
              Attack
            </LcarsButton>
          </>
        )}
      </>
    );
  }
  if (selection.type === 'contact') {
    const c = world.contacts.find((c) => c.id === selection.id);
    if (!c) return <p>接触已过期；未确认击毁。</p>;
    return (
      <>
        <LcarsTextBar>{c.name ?? c.level}</LcarsTextBar>
        <p>
          {c.factionId ?? 'UNKNOWN'} ·{' '}
          {c.hostile ? 'CONFIRMED HOSTILE' : 'UNCONFIRMED / NON-HOSTILE'} ·{' '}
          {c.live ? 'LIVE' : 'LAST KNOWN POSITION'}
        </p>
        <p>
          LAST SEEN {Math.floor(world.time - c.lastSeen)}m · {Math.round(c.x)}, {Math.round(c.y)}
        </p>
        <div className="inline-actions">
          {(['INTERCEPT', 'SHADOW', 'ATTACK', 'DISABLE', 'DRIVE_OFF'] as const).map((t) => (
            <LcarsButton
              key={t}
              tone={t === 'ATTACK' ? 'danger' : 'primary'}
              onClick={() => launch(t)}
            >
              {ACTION_LABELS[t]}
            </LcarsButton>
          ))}
        </div>
        <p className="muted">攻击未确认敌对 Romulan 会产生政治后果。</p>
      </>
    );
  }
  if (selection.type === 'wreck') {
    const x = world.wrecks.find((x) => x.id === selection.id);
    return (
      <>
        <LcarsTextBar>{x?.name ?? 'WRECK'}</LcarsTextBar>
        {x &&
          Object.entries(x.stock).map(([k, v]) => (
            <p key={k}>
              {k} {Math.floor(v)}
            </p>
          ))}
        <LcarsButton onClick={() => launch('RECOVER')}>Recover Actual Cargo</LcarsButton>
      </>
    );
  }
  const loss = world.losses.find((l) => l.shipId === selection.id);
  return (
    <>
      <LcarsTextBar>PERMANENT VESSEL LOSS</LcarsTextBar>
      <p>
        {loss?.name} · {loss?.reason}
      </p>
      <p>新造舰有独立舰籍，原舰不会复活。</p>
    </>
  );
}
