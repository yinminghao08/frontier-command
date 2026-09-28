import type { Snapshot } from '../../engine/types';
import type { Page, CommandSender } from '../types';
import type { ReactNode } from 'react';
import { STATUS, time } from '../format';
import { ResourceStrip } from './ResourceStrip';
import { EventFooter } from './EventFooter';

interface Props {
  world: Snapshot;
  page: Page;
  setPage: (page: Page) => void;
  selected: string;
  selectShip: (id: string) => void;
  setMission: (id: string | null) => void;
  manual: boolean;
  command: CommandSender;
  children: ReactNode;
  inspector: ReactNode;
  overlays: ReactNode;
}
export function LcarsShell({
  world,
  page,
  setPage,
  selected,
  selectShip,
  setMission,
  manual,
  command,
  children,
  inspector,
  overlays,
}: Props) {
  return (
    <div className={`console-shell ${manual ? 'manual-mode' : ''}`}>
      <div className="upper-frame">
        <div className="upper-rail">
          <div className="identity-panel">
            <span>STARFLEET</span>
            <b>曙光特遣舰队</b>
          </div>
          <div className="station-panel">SB-A01 / 2368</div>
        </div>
        <header className="upper-content">
          <h1>FRONTIER COMMAND</h1>
          <div className="header-body">
            <div className="mission-clock">
              <span>DAWN SECTOR / 曙光边区</span>
              <b>{time(world.time)}</b>
              <small>MISSION ELAPSED · 规则模拟</small>
            </div>
            <nav className="primary-nav" aria-label="主导航">
              {(
                [
                  ['overview', '01', '星区总览', 'OVERVIEW'],
                  ['missions', '02', '任务中心', 'OPERATIONS'],
                  ['fleet', '03', '舰队管理', 'STARBASE'],
                  ['logs', '04', '行动日志', 'RECORDS'],
                ] as const
              ).map(([id, num, name, en]) => (
                <button
                  key={id}
                  className={`nav-${id} ${page === id ? 'active' : ''}`}
                  aria-current={page === id ? 'page' : undefined}
                  onClick={() => {
                    setPage(id);
                    setMission(null);
                  }}
                >
                  <span>{num}</span>
                  <strong>{name}</strong>
                  <small>{en}</small>
                </button>
              ))}
            </nav>
          </div>
          <div className="frame-bars upper-bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </header>
      </div>
      <div className="lower-frame">
        <aside className="lower-rail" aria-label="舰船与系统">
          <div className="rail-elbow">
            <span>LCARS / LV1</span>
          </div>
          {world.ships.map((s, index) => (
            <button
              key={s.id}
              className={`rail-ship rail-ship-${index} ${selected === s.id ? 'active' : ''}`}
              aria-pressed={selected === s.id}
              onClick={() => {
                selectShip(s.id);
                setPage('overview');
              }}
            >
              <span>{s.name.replace('U.S.S. ', '')}</span>
              <strong>{s.role.split(' · ')[0]}</strong>
              <small>{STATUS[s.status]}</small>
            </button>
          ))}
          <button
            className="rail-archive"
            onClick={() => {
              setPage('world');
              setMission(null);
            }}
          >
            05 星区档案 <small>ARCHIVES</small>
          </button>
          <button
            className="rail-system"
            onClick={() => {
              setPage('system');
              setMission(null);
            }}
          >
            06 系统 <small>SYSTEM / SAVE</small>
          </button>
          <div className="rail-end">LOCAL / OFFLINE</div>
        </aside>
        <div className="console-main">
          <div className="frame-bars lower-bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <ResourceStrip world={world} command={command} />
          <div className="work-area">
            <main className="main-view">{children}</main>
            <aside className="inspector">{inspector}</aside>
          </div>
          <EventFooter world={world} setPage={setPage} />
          <div className="bottom-band">
            <i />
            <span>LCARS / FRONTIER COMMAND · LV1</span>
            <i />
            <span>{world.paused ? 'SIMULATION PAUSED' : 'SIMULATION ACTIVE'}</span>
          </div>
        </div>
      </div>
      {overlays}
    </div>
  );
}
