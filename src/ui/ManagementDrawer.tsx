import { useState } from 'react';
import type { Snapshot, ModuleId, UpgradeId, CargoKind } from '../engine/types';
import type { ShipClassId } from '../engine/definitions/ships';
import { SHIP_CLASSES } from '../engine/definitions/ships';
import { BUILD_COSTS, MODULES, UPGRADES } from '../engine/definitions/progression';
import { capabilities } from '../engine/capabilities';
import type { TimelineStatus } from '../engine/timeline';
import type { Page, CommandSender } from './types';
import type { Selection } from '../StrategicMap';
import { LcarsDrawer, LcarsButton, LcarsField, LcarsTextBar } from './components/Lcars';
import type { ComposerRequest } from './OrderComposer';
import { defaultAction } from './OrderComposer';
import { ACTION_LABELS } from './format';
export const STARBASE_MODULES = [
  'COMMAND',
  'SHIPYARD',
  'DRYDOCK',
  'ARMORY',
  'ENGINEERING',
  'LOGISTICS',
  'SENSOR CONTROL',
  'DEFENSE GRID',
] as const;
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
  create: (r: ComposerRequest) => void;
  command: CommandSender;
  save: () => void;
  newFrontier: () => void;
}) {
  const [tab, setTab] = useState<(typeof STARBASE_MODULES)[number]>('COMMAND'),
    [classId, setClassId] = useState<keyof typeof BUILD_COSTS>('peregrine'),
    [shipName, setShipName] = useState('USS FRONTIER'),
    [selectedShip, setSelectedShip] = useState('verity'),
    [moduleId, setModuleId] = useState<ModuleId>('expandedCargo'),
    [goods, setGoods] = useState<'supplies' | 'photon' | 'quantum'>('supplies'),
    [amount, setAmount] = useState(10),
    [saleKind, setSaleKind] = useState<CargoKind>('materials');
  const base = world.locations.find((l) => l.id === 'base')!,
    ship = world.ships.find((s) => s.id === selectedShip) ?? world.ships[0],
    shipId = ship?.id ?? '';
  const launch = (type: Parameters<typeof defaultAction>[0], shipId?: string) =>
    create({ action: defaultAction(type, world), shipId });
  const pickShip = (
    <LcarsField>
      VESSEL
      <select
        aria-label="基地舰船"
        value={shipId}
        onChange={(e) => setSelectedShip(e.target.value)}
      >
        {world.ships.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.current?.action.type ?? 'AVAILABLE'}
          </option>
        ))}
      </select>
    </LcarsField>
  );
  const upgrade = (id: UpgradeId) => (
    <div className="record-row">
      <b>
        {UPGRADES[id].label} / {world.upgrades[id] ? 'ONLINE' : 'BASELINE'}
      </b>
      <p>{UPGRADES[id].description}</p>
      <p>
        {UPGRADES[id].cost.credits}C / {UPGRADES[id].cost.materials}M /{' '}
        {UPGRADES[id].cost.specialFinds}F
      </p>
      <LcarsButton
        disabled={!!world.upgrades[id]}
        onClick={() => command({ type: 'upgrade', upgradeId: id })}
      >
        升级 {UPGRADES[id].label}
      </LcarsButton>
    </div>
  );
  return (
    <LcarsDrawer
      title={page === 'STARBASE' ? 'DAWN STARBASE / ' + tab : page + ' / COMMAND RECORDS'}
      label={page + ' 工作面板'}
      onClose={close}
    >
      {page === 'STARBASE' && (
        <>
          <div
            className="inline-actions starbase-tabs"
            role="tablist"
            aria-label="Starbase modules"
          >
            {STARBASE_MODULES.map((t) => (
              <LcarsButton
                role="tab"
                aria-selected={tab === t}
                key={t}
                sound="navigation"
                onClick={() => setTab(t)}
              >
                {t}
              </LcarsButton>
            ))}
          </div>
          <LcarsTextBar>
            CREDITS {Math.floor(world.resources.credits)} / MATERIALS{' '}
            {Math.floor(base.stock.materials)} / SUPPLIES {Math.floor(base.stock.supplies)}
          </LcarsTextBar>
          {tab === 'COMMAND' && (
            <>
              <p>
                ADMIRAL / {world.ships.length} SHIPS · {world.systems.length} KNOWN SYSTEMS · BORDER
                TENSION {Math.round(world.tension)}
              </p>
              <p>联邦后方保底产出支撑最低舰级重建；前沿矿业、殖民地和出口提供更快成长。</p>
              {world.ships.map((s) => (
                <LcarsButton
                  key={s.id}
                  shape="rail"
                  className="record-row"
                  onClick={() => select({ type: 'ship', id: s.id })}
                >
                  {s.name} · {s.current ? ACTION_LABELS[s.current.action.type] : 'AVAILABLE'} ·
                  QUEUE {s.queue.length}
                </LcarsButton>
              ))}
            </>
          )}
          {tab === 'SHIPYARD' && (
            <>
              {upgrade('shipyard')}
              <LcarsField>
                HULL CLASS
                <select
                  aria-label="建造舰级"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value as typeof classId)}
                >
                  {Object.entries(BUILD_COSTS).map(([id, c]) => (
                    <option key={id} value={id}>
                      {SHIP_CLASSES[id as ShipClassId].name} · {c.credits}C / {c.materials}M /{' '}
                      {c.supplies}S
                    </option>
                  ))}
                </select>
              </LcarsField>
              <LcarsField>
                VESSEL NAME
                <input
                  aria-label="新舰名称"
                  value={shipName}
                  onChange={(e) => setShipName(e.target.value)}
                />
              </LcarsField>
              <LcarsButton onClick={() => command({ type: 'buildShip', classId, name: shipName })}>
                建造新舰
              </LcarsButton>
              <p>新舰空弹舱交付；在 Armory 装载真实弹药。最低舰级始终可建。</p>
            </>
          )}
          {tab === 'DRYDOCK' && (
            <>
              {pickShip}
              <p>维修消耗现场 Materials，恢复 Hull / Engines / Weapons；可途中改令。</p>
              <LcarsButton onClick={() => launch('REPAIR', shipId)}>Dock & Repair</LcarsButton>
            </>
          )}
          {tab === 'ARMORY' && (
            <>
              {upgrade('armory')}
              <p>
                PHOTON {base.stock.photon} / QUANTUM {base.stock.quantum} · 实物弹药
              </p>
              {pickShip}
              <LcarsButton onClick={() => launch('REARM', shipId)}>指定数量装弹</LcarsButton>
            </>
          )}
          {tab === 'ENGINEERING' && (
            <>
              {pickShip}
              <LcarsField>
                MODULE
                <select
                  aria-label="基地模块"
                  value={moduleId}
                  onChange={(e) => setModuleId(e.target.value as ModuleId)}
                >
                  {Object.entries(MODULES).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </LcarsField>
              <p>{MODULES[moduleId].description}</p>
              <p>
                {MODULES[moduleId].cost.credits}C / {MODULES[moduleId].cost.materials}M /{' '}
                {MODULES[moduleId].cost.specialFinds} Special Finds · SLOTS{' '}
                {ship?.modules.length ?? 0}/{ship ? capabilities(ship).moduleSlots : 0}
              </p>
              <LcarsButton
                onClick={() =>
                  create({
                    shipId,
                    action: { type: 'REFIT', targetId: 'base', moduleId, remove: false },
                  })
                }
              >
                安装 / 调整模块
              </LcarsButton>
            </>
          )}
          {tab === 'LOGISTICS' && (
            <>
              {upgrade('logistics')}
              <LcarsTextBar>ACTUAL BASE INVENTORY</LcarsTextBar>
              {Object.entries(base.stock).map(([k, v]) => (
                <p key={k}>
                  {k.toUpperCase()} {Math.floor(v)}
                </p>
              ))}
              <LcarsButton onClick={() => launch('HAUL')}>规划真实货运 / 循环航线</LcarsButton>
              <LcarsField>
                EXPORT
                <select
                  aria-label="出口货种"
                  value={saleKind}
                  onChange={(e) => setSaleKind(e.target.value as CargoKind)}
                >
                  {Object.keys(base.stock).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </LcarsField>
              <LcarsButton
                onClick={() => command({ type: 'sellStock', cargoKind: saleKind, amount })}
              >
                出口 {amount} / 消耗库存
              </LcarsButton>
            </>
          )}
          {tab === 'SENSOR CONTROL' && (
            <>
              {upgrade('sensors')}
              <p>
                {world.systems.length} SYSTEMS / {world.bodies.length} KNOWN BODIES /{' '}
                {world.contacts.length} CONTACTS
              </p>
              <LcarsButton onClick={() => launch('EXPLORE')}>Explore UNKNOWN SPACE</LcarsButton>
              <LcarsButton onClick={() => launch('SURVEY')}>Remote / Close / Deep Scan</LcarsButton>
            </>
          )}
          {tab === 'DEFENSE GRID' && (
            <>
              {upgrade('defense')}
              {world.locations
                .filter((l) => l.owner === 'starfleet')
                .map((l) => (
                  <LcarsButton
                    key={l.id}
                    shape="rail"
                    className="record-row"
                    onClick={() => select({ type: 'location', id: l.id })}
                  >
                    {l.name} · SHIELD {Math.ceil(l.shield)} / {l.maxShield} · HULL{' '}
                    {Math.ceil(l.hull)}
                  </LcarsButton>
                ))}
            </>
          )}
          {(tab === 'ARMORY' || tab === 'ENGINEERING' || tab === 'LOGISTICS') && (
            <>
              <LcarsTextBar>INDUSTRY / PHYSICAL OUTPUT</LcarsTextBar>
              <LcarsField>
                RECIPE
                <select
                  aria-label="制造资源"
                  value={goods}
                  onChange={(e) => setGoods(e.target.value as typeof goods)}
                >
                  <option value="supplies">Supplies / Materials 0.3 + Credits 2</option>
                  <option value="photon">Photon / Materials 1 + Credits 2</option>
                  <option value="quantum">Quantum / Materials 2 + Credits 8</option>
                </select>
              </LcarsField>
              <LcarsField>
                QUANTITY
                <input
                  aria-label="工业数量"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </LcarsField>
              <LcarsButton
                onClick={() => command({ type: 'manufacture', cargoKind: goods, amount })}
              >
                开始实物制造
              </LcarsButton>
            </>
          )}
          <LcarsTextBar>SHIPYARD / INDUSTRY QUEUE</LcarsTextBar>
          {world.jobs
            .filter((j) => !j.complete)
            .map((j) => (
              <p key={j.id}>
                {j.name} · {Math.floor(j.work)} / {j.duration}m
              </p>
            ))}
        </>
      )}
      {page === 'OPERATIONS' && (
        <>
          <LcarsTextBar>WORLD OPPORTUNITIES / LIVE CAUSES</LcarsTextBar>
          <div className="inline-actions">
            {(['EXPLORE', 'MINE', 'HAUL', 'PATROL'] as const).map((t) => (
              <LcarsButton key={t} onClick={() => launch(t)}>
                {ACTION_LABELS[t]}
              </LcarsButton>
            ))}
          </div>
          {world.opportunities.map((o) => (
            <LcarsButton
              key={o.id}
              shape="rail"
              className="record-row"
              onClick={() => {
                const type = world.bodies.some((b) => b.id === o.targetId)
                  ? 'body'
                  : world.projects.some((p) => p.id === o.targetId)
                    ? 'project'
                    : world.locations.some((l) => l.id === o.targetId)
                      ? 'location'
                      : world.contacts.some((c) => c.id === o.targetId)
                        ? 'contact'
                        : null;
                if (type) select({ type, id: o.targetId });
                else {
                  const parts = o.targetId.split(':');
                  select({ type: 'sector', q: Number(parts[1]), r: Number(parts[2]) });
                }
              }}
            >
              {o.kind.toUpperCase()} · {o.text}
            </LcarsButton>
          ))}
        </>
      )}
      {page === 'PERSONNEL' && (
        <>
          <p>
            独立规则执行者身份；Admiral 无需等待人员分配即可指挥任意己方舰船。未来 Agent
            使用受验证的结构化动作接口。
          </p>
          {world.operators.map((op) => (
            <p key={op.id}>
              {op.name} · {op.availability.toUpperCase()}
            </p>
          ))}
        </>
      )}
      {page === 'COLONIES' && (
        <>
          <LcarsTextBar>FRONTIER / COLONIES / MINES / OUTPOSTS</LcarsTextBar>
          {world.locations
            .filter((l) => l.owner === 'starfleet' && l.id !== 'base')
            .map((l) => (
              <LcarsButton
                key={l.id}
                shape="rail"
                className="record-row"
                onClick={() => select({ type: 'location', id: l.id })}
              >
                {l.name} / {l.kind} · SUPPLIES {Math.floor(l.stock.supplies)} · MATERIALS{' '}
                {Math.floor(l.stock.materials)}
              </LcarsButton>
            ))}
          <LcarsTextBar>CONSTRUCTION PROJECTS</LcarsTextBar>
          {world.projects.map((p) => (
            <LcarsButton
              key={p.id}
              shape="rail"
              className="record-row"
              onClick={() => select({ type: 'project', id: p.id })}
            >
              {p.name} · {p.complete ? 'COMPLETE' : Math.floor(p.work) + '/' + p.duration + 'm'} · M{' '}
              {Math.floor(p.stock.materials)}/{p.cost.materials} / S {Math.floor(p.stock.supplies)}/
              {p.cost.supplies}
            </LcarsButton>
          ))}
          <p>在星图选择已调查资源点／系统／宜居星球建立新设施。</p>
        </>
      )}
      {page === 'ARCHIVE' && (
        <>
          <div className="inline-actions">
            <LcarsButton onClick={save}>立即保存</LcarsButton>
            <LcarsButton tone="danger" onClick={newFrontier}>
              BEGIN NEW FRONTIER
            </LcarsButton>
          </div>
          <LcarsTextBar>PERMANENT LOSSES / {world.losses.length}</LcarsTextBar>
          {world.losses.map((l) => (
            <LcarsButton
              key={l.shipId}
              shape="rail"
              className="record-row"
              onClick={() => select({ type: 'loss', id: l.shipId })}
            >
              {l.name} · {l.reason}
            </LcarsButton>
          ))}
          <LcarsTextBar>TIMELINES</LcarsTextBar>
          {timeline.branches.map((b) => (
            <p key={b.id}>
              {b.id} / {b.status} / {b.lossCount} LOSSES
            </p>
          ))}
          <LcarsTextBar>PERSISTENT FRONTIER HISTORY / {world.history.length}</LcarsTextBar>
          {[...world.history].reverse().map((h) => (
            <p key={h.id}>
              <small>
                {Math.floor(h.time)}m / {h.kind}
              </small>{' '}
              {h.text}
            </p>
          ))}
        </>
      )}
    </LcarsDrawer>
  );
}
