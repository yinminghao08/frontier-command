import { useState, type ReactNode } from 'react';
import type { Snapshot } from '../../engine/types';
import type { CommandSender, Page } from '../types';
import { gameCalendar } from '../../engine/clock';
import { KIND, PHASE } from '../OrderComposer';
import { actionProgress } from '../format';
export const PAGES: Page[] = [
  'SECTOR',
  'OPERATIONS',
  'PERSONNEL',
  'STARBASE',
  'COLONIES',
  'ARCHIVE',
];
export const LABELS = ['星区', '行动', '人员', '基地', '殖民地', '档案'];
export function LcarsShell({
  world,
  page,
  onPage,
  command,
  locate,
  children,
  inspector,
}: {
  world: Snapshot;
  page: Page;
  onPage: (p: Page) => void;
  command: CommandSender;
  locate: (id: string | null) => void;
  children: ReactNode;
  inspector: ReactNode;
}) {
  const [showRead, setShowRead] = useState(false),
    cal = gameCalendar(world.tick),
    active = world.orders.filter((o) => o.phase !== 'complete'),
    lost = world.status === 'commandLost';
  const communications = [...world.communications]
    .filter((c) => showRead || !c.read)
    .sort(
      (a, b) =>
        ({ urgent: 3, high: 2, normal: 1 })[b.priority] -
          { urgent: 3, high: 2, normal: 1 }[a.priority] || b.id - a.id,
    );
  const base = world.locations.find((l) => l.id === 'base')!;
  return (
    <div className="admiral-console">
      <header className="command-header">
        <div className="identity-panel">
          <span>STARFLEET</span>
          <b>DAWN FRONTIER</b>
          <small>ADMIRAL / COMMAND</small>
        </div>
        <section className="clock-panel">
          <h1>FRONTIER COMMAND</h1>
          <strong data-testid="game-clock">
            DAY {cal.day}{' '}
            <b>
              {String(cal.hour).padStart(2, '0')}:{String(cal.minute).padStart(2, '0')}
            </b>
          </strong>
          <div className="time-controls">
            <button
              disabled={lost}
              aria-pressed={world.paused}
              onClick={() => command({ type: 'pause', paused: !world.paused }, true)}
            >
              {world.paused ? '继续' : '暂停'}
            </button>
            {([1, 4, 16] as const).map((speed) => (
              <button
                key={speed}
                disabled={lost}
                aria-pressed={world.speed === speed}
                onClick={() => command({ type: 'speed', speed }, true)}
              >
                {speed}×
              </button>
            ))}
          </div>
        </section>
        <section className="communications">
          <div className="section-title">
            <span>PRIORITY COMMUNICATIONS</span>
            <button onClick={() => setShowRead(!showRead)}>
              {showRead ? '仅未读' : '全部通信'}
            </button>
          </div>
          <div className="comms-list">
            {communications.length ? (
              communications.map((c) => (
                <div key={c.id} className={'comms-item ' + c.priority}>
                  <button className="comms-content" onClick={() => locate(c.entityId)}>
                    <span>
                      {c.priority.toUpperCase()} / {Math.floor(c.time)}m
                    </span>
                    {c.text}
                  </button>
                  <button
                    className="ack-button"
                    disabled={c.read || lost}
                    aria-label={'确认通信 ' + c.id}
                    onClick={() => command({ type: 'acknowledge', communicationId: c.id }, true)}
                  >
                    {c.read ? '已读' : '确认'}
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">CHANNEL CLEAR · 暂无待处理通信</p>
            )}
          </div>
        </section>
        <section className="strategic-state">
          <small>COMMAND INTEGRITY</small>
          <strong className={lost ? 'danger-text' : ''}>
            {lost ? 'COMMAND LOST' : Math.ceil(base.hull) + ' / ' + base.maxHull}
          </strong>
          <span>
            SHIELD {Math.ceil(base.shield)} · READY{' '}
            {world.ships.filter((s) => s.status === 'docked').length}/{world.ships.length}
          </span>
          <span>{world.contacts.filter((c) => c.hostile && c.live).length} HOSTILE CONTACTS</span>
        </section>
        <div className="header-band" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </header>
      <nav className="section-nav" aria-label="主导航">
        <div className="nav-cap">
          SECTOR
          <br />
          <b>047</b>
        </div>
        {PAGES.map((p, i) => (
          <button
            key={p}
            aria-current={page === p ? 'page' : undefined}
            className={page === p ? 'selected' : ''}
            onClick={() => onPage(page === p ? 'SECTOR' : p)}
          >
            <small>0{i + 1}</small>
            <b>{p}</b>
            <span>{LABELS[i]}</span>
          </button>
        ))}
        <div className="nav-bottom">
          LCARS / 2368
          <br />
          RULES AI
          <br />
          LOCAL FRONTIER
        </div>
      </nav>
      <main className="sector-workspace">
        {world.pauseReasons.length > 0 && !lost && (
          <div className="critical-banner" role="alert">
            <b>PRIORITY HOLD</b>
            <span>{world.pauseReasons.map((r) => r.message).join(' · ')}</span>
            <button onClick={() => command({ type: 'pause', paused: false }, true)}>
              处置后继续
            </button>
          </div>
        )}
        {children}
      </main>
      <aside className="inspector" aria-label="对象 Inspector">
        <div className="section-title">CONTEXT INSPECTOR</div>
        <div className="inspector-content">{inspector}</div>
      </aside>
      <footer className="operations-footer">
        <div className="footer-title">
          <b>ACTIVE OPERATIONS</b>
          <small>
            {lost ? 'COMMAND LOST' : world.paused ? 'SIMULATION PAUSED' : 'SIMULATION ACTIVE'}
          </small>
        </div>
        <div className="operation-strip">
          {active.length ? (
            active.map((o) => (
              <button
                key={o.id}
                className={'operation-chip ' + (o.phase === 'decision' ? 'attention' : '')}
                onClick={() => locate(o.id)}
              >
                <b>
                  {KIND[o.kind]} / {o.id}
                </b>
                <span>
                  {o.held ? 'HOLD' : PHASE[o.phase]} · {o.shipIds.length} ASSETS
                </span>
                <small>{actionProgress(world, o).text}</small>
              </button>
            ))
          ) : (
            <span className="muted">NO ACTIVE OPERATIONS · 从星图选择目标下达高层任务</span>
          )}
        </div>
      </footer>
    </div>
  );
}
