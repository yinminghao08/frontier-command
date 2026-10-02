import { useEffect, useState, type ReactNode } from 'react';
import type { Snapshot } from '../../engine/types';
import type { CommandSender, Page } from '../types';
import { gameCalendar } from '../../engine/clock';
import { ACTION_LABELS } from '../format';
import { actionProgress } from '../format';
import { LcarsBar, LcarsButton, LcarsElbow, LcarsTextBar } from './Lcars';
import { DataCascade } from '../lcars/DataCascade';
import { usePanelFocus } from '../lcars/usePanelFocus';
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
  overlay,
  onSettings,
  contextSerial,
}: {
  world: Snapshot;
  page: Page;
  onPage: (p: Page) => void;
  command: CommandSender;
  locate: (id: string | null) => void;
  children: ReactNode;
  inspector: ReactNode;
  overlay?: ReactNode;
  onSettings: () => void;
  contextSerial: string;
}) {
  const [showRead, setShowRead] = useState(false),
    [showContext, setShowContext] = useState(false);
  const contextRef = usePanelFocus(() => setShowContext(false), false, showContext);
  useEffect(() => {
    if (matchMedia('(max-width: 1100px)').matches) setShowContext(true);
  }, [contextSerial]);
  const cal = gameCalendar(world.tick),
    active = world.ships,
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
        <div className="header-rail">
          <div className="identity-panel">
            <span>STARFLEET COMMAND</span>
            <strong>
              DAWN
              <br />
              FRONTIER
            </strong>
          </div>
          <LcarsElbow orientation="upper" className="header-elbow">
            <span>ADMIRAL / 047</span>
          </LcarsElbow>
        </div>
        <div className="header-body">
          <div className="banner">
            <span>FEDERATION NETWORK / LCARS 26</span>
            <h1>FRONTIER COMMAND</h1>
          </div>
          <div className="command-deck">
            <DataCascade world={world} />
            <section className="communications" aria-label="Priority Communications">
              <div className="comms-heading">
                <LcarsTextBar className="section-title">PRIORITY COMMUNICATIONS</LcarsTextBar>
                <LcarsButton sound="navigation" onClick={() => setShowRead(!showRead)}>
                  {showRead ? '仅未读' : '全部通信'}
                </LcarsButton>
              </div>
              <div className="comms-list">
                {world.pauseReasons.length > 0 && !lost && (
                  <div className="critical-banner" role="alert">
                    <b>PRIORITY HOLD</b>
                    <span>{world.pauseReasons.map((r) => r.message).join(' · ')}</span>
                    <LcarsButton
                      tone="danger"
                      onClick={() => command({ type: 'pause', paused: false }, true)}
                    >
                      处置后继续
                    </LcarsButton>
                  </div>
                )}

                {communications.length ? (
                  communications.map((c) => (
                    <div key={c.id} className={'comms-item ' + c.priority}>
                      <LcarsButton
                        shape="text"
                        sound="navigation"
                        className="comms-content"
                        onClick={() => locate(c.entityId)}
                      >
                        <span>
                          {c.priority.toUpperCase()} / {Math.floor(c.time)}m
                        </span>
                        {c.text}
                      </LcarsButton>
                      <LcarsButton
                        tone="secondary"
                        className="ack-button"
                        disabled={c.read || lost}
                        aria-label={'确认通信 ' + c.id}
                        onClick={() =>
                          command({ type: 'acknowledge', communicationId: c.id }, true)
                        }
                      >
                        {c.read ? '已读' : '确认'}
                      </LcarsButton>
                    </div>
                  ))
                ) : (
                  <p className="muted">CHANNEL CLEAR · 暂无待处理通信</p>
                )}
              </div>
            </section>
            <section className="clock-panel" aria-label="Simulation controls">
              <strong data-testid="game-clock">
                DAY {cal.day}
                <b>
                  {String(cal.hour).padStart(2, '0')}:{String(cal.minute).padStart(2, '0')}
                </b>
              </strong>
              <div className="time-controls">
                <LcarsButton
                  disabled={lost}
                  aria-pressed={world.paused}
                  onClick={() => command({ type: 'pause', paused: !world.paused }, true)}
                >
                  {world.paused ? '继续' : '暂停'}
                </LcarsButton>
                {([1, 4, 16] as const).map((speed) => (
                  <LcarsButton
                    key={speed}
                    disabled={lost}
                    aria-pressed={world.speed === speed}
                    onClick={() => command({ type: 'speed', speed }, true)}
                  >
                    {speed}×
                  </LcarsButton>
                ))}
              </div>
              <div className="strategic-state">
                <span>
                  HULL{' '}
                  <b className={lost ? 'danger-text' : ''}>
                    {lost ? 'LOST' : Math.ceil(base.hull)}
                  </b>{' '}
                  / {base.maxHull}
                </span>
                <span>
                  SHIELD <b>{Math.ceil(base.shield)}</b>
                </span>
              </div>
              <div className="strategic-state">
                <span>
                  READY{' '}
                  <b>
                    {world.ships.filter((s) => s.status === 'docked').length}/{world.ships.length}
                  </b>
                </span>
                <span>
                  HOSTILES <b>{world.contacts.filter((c) => c.hostile && c.live).length}</b>
                </span>
              </div>
            </section>
          </div>
          <LcarsBar className="header-band" />
        </div>
      </header>
      <nav className="section-nav" aria-label="主导航">
        <LcarsElbow className="nav-cap">
          <span>SECTOR</span>
          <strong>047</strong>
        </LcarsElbow>
        {PAGES.map((p, i) => (
          <LcarsButton
            key={p}
            shape="rail"
            tone={i === 1 || i === 4 ? 'orange' : i === 3 ? 'secondary' : 'almond'}
            sound="navigation"
            aria-current={page === p ? 'page' : undefined}
            onClick={() => onPage(page === p ? 'SECTOR' : p)}
          >
            <small>0{i + 1}</small>
            <b>{p}</b>
            <span>{LABELS[i]}</span>
          </LcarsButton>
        ))}
        <div className="nav-bottom">
          <span>
            LCARS / 2368
            <br />
            RULES AI / LOCAL
          </span>
          <LcarsButton
            shape="flat"
            sound="navigation"
            tone="almond"
            onClick={onSettings}
            aria-label="Console Settings"
          >
            CONSOLE SETTINGS
          </LcarsButton>
        </div>
      </nav>
      <LcarsBar variant="lower" className="body-band" />
      <main className="sector-workspace">
        {children}
        <LcarsButton
          className="compact-context"
          sound="navigation"
          onClick={() => setShowContext(true)}
          aria-label="打开 Inspector"
        >
          CONTEXT INSPECTOR
        </LcarsButton>
        {overlay}
      </main>
      <aside
        ref={contextRef}
        tabIndex={-1}
        className={'inspector ' + (showContext ? 'is-open' : '')}
        aria-label="对象 Inspector"
      >
        <div className="inspector-heading">
          <LcarsTextBar className="section-title">CONTEXT INSPECTOR</LcarsTextBar>
          <LcarsButton
            className="inspector-close"
            aria-label="关闭 Inspector"
            sound="navigation"
            onClick={() => setShowContext(false)}
          >
            CLOSE
          </LcarsButton>
        </div>
        <div className="inspector-content">
          <div key={contextSerial} className="context-transition">
            {inspector}
          </div>
        </div>
      </aside>
      <footer className="operations-footer">
        <div className="footer-title">
          <LcarsTextBar>FLEET DIRECTIVES</LcarsTextBar>
          <small>
            {lost ? 'COMMAND LOST' : world.paused ? 'SIMULATION PAUSED' : 'SIMULATION ACTIVE'}
          </small>
        </div>
        <div className="operation-strip">
          {active.length ? (
            active.map((o) => (
              <LcarsButton
                sound="navigation"
                key={o.id}
                data-ship-id={o.id}
                className={'operation-chip ' + (o.current ? 'attention' : '')}
                onClick={() => locate(o.id)}
              >
                <b>{o.name.split(' / ')[0]}</b>
                <span>
                  {o.current ? ACTION_LABELS[o.current.action.type] : 'AVAILABLE'} ·{' '}
                  {o.queue.length} QUEUED / {o.suspended.length} SUSPENDED
                </span>
                <small>{actionProgress(world, o).text}</small>
              </LcarsButton>
            ))
          ) : (
            <span className="muted">NO FLEET DIRECTIVES · 从星图选择目标下达高层任务</span>
          )}
        </div>
      </footer>
    </div>
  );
}
