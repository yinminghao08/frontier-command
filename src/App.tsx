import { useState } from 'react';
import { useFrontier } from './ui/hooks/useFrontier';
import { TacticalMap, type Selection } from './TacticalMap';
import { Inspector } from './ui/Inspector';
import { OrderComposer, KIND, PHASE } from './ui/OrderComposer';
import type { OperationOrder, OrderKind, Point } from './engine/types';
import type { Page } from './ui/types';
import { SHIP_CLASSES } from './engine/definitions/ships';
import { gameCalendar } from './engine/clock';
import { actionProgress } from './ui/format';
const PAGES: Page[] = ['SECTOR', 'OPERATIONS', 'PERSONNEL', 'STARBASE', 'COLONIES', 'ARCHIVE'];
const LABELS = ['星区', '行动', '人员', '基地', '殖民地', '档案'];
export function App() {
  const { world, notice, command, save, reset, dismissNotice } = useFrontier();
  const [page, setPage] = useState<Page>('SECTOR');
  const [selection, setSelection] = useState<Selection | null>({ type: 'location', id: 'base' });
  const [focus, setFocus] = useState<{ point: Point; serial: number } | null>(null);
  const [composer, setComposer] = useState<{ kind: OrderKind; existing?: OperationOrder } | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [showRead, setShowRead] = useState(false);
  if (!world)
    return (
      <div className="loading">
        <h1>FRONTIER COMMAND</h1>
        <p>{window.frontier ? '正在连接曙光基地…' : '请通过 Electron 启动：npm start'}</p>
      </div>
    );
  const cal = gameCalendar(world.tick),
    active = world.orders.filter((o) => o.phase !== 'complete');
  const base = world.locations.find((l) => l.id === 'base')!;
  const selectedPoint = (s: Selection): Point | undefined => {
    if (s.type === 'point') return s;
    if (s.type === 'ship') return world.ships.find((x) => x.id === s.id);
    if (s.type === 'location') return world.locations.find((x) => x.id === s.id);
    if (s.type === 'contact') return world.contacts.find((x) => x.id === s.id);
    return world.orders.find((x) => x.id === s.id)?.targetLastSeen ?? undefined;
  };
  const select = (s: Selection, locate = false) => {
    setSelection(s);
    if (locate) {
      const p = selectedPoint(s);
      if (p) setFocus({ point: { x: p.x, y: p.y }, serial: Date.now() });
    }
  };
  const locate = (id: string | null) => {
    if (!id) return;
    const type = world.orders.some((o) => o.id === id)
      ? 'order'
      : world.ships.some((s) => s.id === id)
        ? 'ship'
        : world.locations.some((l) => l.id === id)
          ? 'location'
          : 'contact';
    select({ type, id }, true);
  };
  const communications = [...world.communications]
    .filter((c) => showRead || !c.read)
    .sort(
      (a, b) =>
        ({ urgent: 3, high: 2, normal: 1 })[b.priority] -
          { urgent: 3, high: 2, normal: 1 }[a.priority] || b.id - a.id,
    );
  return (
    <div className="admiral-console">
      <header className="command-header">
        <section className="clock-panel">
          <span>STARFLEET / DAWN</span>
          <h1>FRONTIER COMMAND</h1>
          <strong data-testid="game-clock">
            Day {cal.day}{' '}
            <b>
              {String(cal.hour).padStart(2, '0')}:{String(cal.minute).padStart(2, '0')}
            </b>
          </strong>
          <div className="time-controls">
            <button
              className={world.paused ? 'selected' : ''}
              onClick={() => command({ type: 'pause', paused: !world.paused })}
            >
              {world.paused ? '继续' : '暂停'}
            </button>
            {([1, 4, 16] as const).map((speed) => (
              <button
                key={speed}
                aria-pressed={world.speed === speed}
                onClick={() => command({ type: 'speed', speed })}
              >
                {speed}×
              </button>
            ))}
          </div>
        </section>
        <section className="communications">
          <div className="section-title">
            <span>COMMAND / PRIORITY COMMUNICATIONS</span>
            <button className="text-button" onClick={() => setShowRead(!showRead)}>
              {showRead ? '仅未读' : '全部通信'}
            </button>
          </div>
          <div className="comms-list">
            {communications.length ? (
              communications.map((c) => (
                <div key={c.id} className={'comms-item ' + c.priority}>
                  <button className="comms-content" onClick={() => locate(c.entityId)}>
                    <span>
                      {c.priority.toUpperCase()} · {Math.floor(c.time)}m
                    </span>
                    {c.text}
                  </button>
                  <button
                    className="ack-button"
                    disabled={c.read}
                    aria-label={'确认通信 ' + c.id}
                    onClick={() => command({ type: 'acknowledge', communicationId: c.id }, true)}
                  >
                    {c.read ? '已读' : '确认'}
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">暂无待处理通信。可从星图或 OPERATIONS 创建行动。</p>
            )}
          </div>
        </section>
        <section className="strategic-state">
          <small>STRATEGIC STATUS</small>
          <div>
            <b>
              {world.ships.filter((s) => s.status === 'docked' && !s.orderId).length} /{' '}
              {world.ships.length}
            </b>
            <span>可用舰船</span>
            <b>{active.length}</b>
            <span>进行中行动</span>
            <b>{world.contacts.filter((c) => c.hostile && c.live).length}</b>
            <span>已知敌对接触</span>
            <b>{Math.floor(base.stock.supplies - base.reserved.supplies)}</b>
            <span>可用补给</span>
          </div>
        </section>
      </header>
      <nav className="section-nav" aria-label="主导航">
        <div className="nav-cap">
          ADMIRAL
          <br />
          COMMAND
        </div>
        {PAGES.map((p, i) => (
          <button
            key={p}
            aria-current={page === p ? 'page' : undefined}
            className={page === p ? 'selected' : ''}
            onClick={() => setPage(p)}
          >
            <small>0{i + 1}</small>
            <b>{p}</b>
            <span>{LABELS[i]}</span>
          </button>
        ))}
        <div className="nav-bottom">
          LCARS
          <br />
          LV1 RULES AI
          <br />
          LOCAL / OFFLINE
        </div>
      </nav>
      <main className="sector-workspace">
        {world.pauseReasons.length > 0 && (
          <div className="critical-banner" role="alert">
            <b>自动暂停</b>
            <span>{world.pauseReasons.map((r) => r.message).join(' · ')}</span>
            <button onClick={() => command({ type: 'pause', paused: false })}>处置后继续</button>
          </div>
        )}
        <TacticalMap
          world={world}
          selection={selection}
          onSelect={(s) => select(s)}
          focus={focus}
        />
        {page !== 'SECTOR' && (
          <section className="context-panel" aria-label={page + ' 工作面板'}>
            <div className="section-title">
              <span>
                {page} / {LABELS[PAGES.indexOf(page)]}
              </span>
              <button className="text-button" onClick={() => setPage('SECTOR')}>
                收起面板
              </button>
            </div>
            {page === 'OPERATIONS' && (
              <>
                <div className="inline-actions">
                  {(['defense', 'transport', 'explore'] as const).map((kind) => (
                    <button key={kind} onClick={() => setComposer({ kind })}>
                      新建{KIND[kind]}
                    </button>
                  ))}
                </div>
                <div className="horizontal-cards">
                  {world.orders.length ? (
                    world.orders
                      .slice()
                      .reverse()
                      .map((o) => (
                        <button
                          className="summary-card"
                          key={o.id}
                          onClick={() => select({ type: 'order', id: o.id }, true)}
                        >
                          <b>
                            {o.id} · {KIND[o.kind]}
                          </b>
                          <span>
                            {PHASE[o.phase]} · {o.outcome ?? o.priority}
                          </span>
                        </button>
                      ))
                  ) : (
                    <p className="muted">
                      没有固定任务卡。指定目标、舰船与执行政策，创建你的第一项行动。
                    </p>
                  )}
                </div>
              </>
            )}
            {page === 'PERSONNEL' && (
              <div className="horizontal-cards">
                {world.operators.map((op) => {
                  const s = world.ships.find((s) => s.id === op.shipId)!;
                  return (
                    <button
                      key={op.id}
                      className="summary-card"
                      onClick={() => select({ type: 'ship', id: s.id }, true)}
                    >
                      <b>{op.name}</b>
                      <span>{s.name}</span>
                      <small>LV1 确定性规则 AI · {s.behavior}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {page === 'STARBASE' && (
              <div className="horizontal-cards">
                {world.ships.map((s) => (
                  <button
                    className="summary-card"
                    key={s.id}
                    onClick={() => select({ type: 'ship', id: s.id }, true)}
                  >
                    <b>{SHIP_CLASSES[s.classId].name}</b>
                    <span>
                      Hull {Math.round(s.hull)} · Photon {s.photon} · Quantum {s.quantum}
                    </span>
                    <small>{s.status} · 点击安排维修／装弹</small>
                  </button>
                ))}
              </div>
            )}
            {page === 'COLONIES' && (
              <div className="horizontal-cards">
                {world.locations
                  .filter(
                    (l) =>
                      l.regionId === 'federation' && ['colony', 'outpost', 'mine'].includes(l.kind),
                  )
                  .map((l) => (
                    <button
                      className="summary-card"
                      key={l.id}
                      onClick={() => select({ type: 'location', id: l.id }, true)}
                    >
                      <b>
                        {l.name}
                        {l.distress ? ' · 求援' : ''}
                      </b>
                      <span>
                        完整度 {Math.round(l.hull)} · 补给 {Math.floor(l.stock.supplies)}
                      </span>
                      <small>
                        医疗 {l.stock.medical} · 材料 {l.stock.materials}
                      </small>
                    </button>
                  ))}
              </div>
            )}
            {page === 'ARCHIVE' && (
              <div className="archive-layout">
                <div>
                  <p>
                    Admiral 统筹边疆防卫、运输与科学调查。所有自动行为均为确定性规则
                    AI；本阶段不含模型、升级、学员或制造。
                  </p>
                  <span className="badge">
                    科研 {world.resources.science} · 情报 {world.resources.intel} · 配额{' '}
                    {world.resources.allocation}
                  </span>
                  <div className="inline-actions">
                    <button onClick={save}>立即保存</button>
                    <button onClick={() => setConfirmReset(true)}>新世界</button>
                  </div>
                </div>
                <div className="archive-log">
                  {world.logs
                    .slice()
                    .reverse()
                    .map((l) => (
                      <p key={l.id}>
                        <small>{Math.floor(l.time)}m</small> {l.text}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
      <aside className="inspector" aria-label="对象 Inspector">
        <div className="section-title">
          <span>OBJECT INSPECTOR</span>
          {selection && (
            <button className="text-button" onClick={() => select(selection, true)}>
              定位
            </button>
          )}
        </div>
        <div className="inspector-content">
          <Inspector
            world={world}
            selection={selection}
            select={(s) => select(s)}
            command={command}
            create={(kind) => setComposer({ kind })}
            edit={(existing) => setComposer({ kind: existing.kind, existing })}
          />
        </div>
      </aside>
      <footer className="operations-footer">
        <div className="footer-title">
          <b>ACTIVE OPERATIONS</b>
          <small>{world.paused ? 'SIMULATION PAUSED' : 'SIMULATION ACTIVE'}</small>
        </div>
        <div className="operation-strip">
          {active.length ? (
            active.map((o) => (
              <button
                key={o.id}
                className={'operation-chip ' + (o.phase === 'decision' ? 'attention' : '')}
                onClick={() => select({ type: 'order', id: o.id }, true)}
              >
                <b>
                  {KIND[o.kind]} / {o.id}
                </b>
                <span>
                  {o.held ? '暂停执行' : PHASE[o.phase]} ·{' '}
                  {o.shipIds
                    .map((id) => SHIP_CLASSES[world.ships.find((s) => s.id === id)!.classId].name)
                    .join(', ')}
                </span>
                <small>{actionProgress(world, o).text}</small>
              </button>
            ))
          ) : (
            <span className="muted">
              无执行中行动 · 从 OPERATIONS 创建，或选择地图对象下达命令。
            </span>
          )}
        </div>
      </footer>
      {notice && (
        <div className={'notification ' + (notice.error ? 'error' : '')} role="status">
          {notice.text}
          <button onClick={dismissNotice} aria-label="关闭通知">
            ×
          </button>
        </div>
      )}
      {composer && (
        <OrderComposer
          world={world}
          kind={composer.kind}
          existing={composer.existing}
          selection={selection}
          command={command}
          onClose={() => {
            setComposer(null);
            setPage('OPERATIONS');
          }}
        />
      )}
      {confirmReset && (
        <div className="composer-backdrop">
          <section className="reset-dialog" role="dialog" aria-label="新世界确认">
            <h2>开始新的边疆世界？</h2>
            <p>当前 v4 存档将归档保留。旧版 v1–v3 文件不会加载或修改。</p>
            <div className="inline-actions">
              <button onClick={() => setConfirmReset(false)}>取消</button>
              <button
                className="primary"
                onClick={async () => {
                  const r = await reset();
                  if (r.ok) {
                    setConfirmReset(false);
                    setSelection({ type: 'location', id: 'base' });
                    setPage('SECTOR');
                    setFocus(null);
                  }
                }}
              >
                归档并创建新世界
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
