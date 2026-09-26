import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, Mission, Ship, Snapshot } from './engine/types';
import { TacticalMap } from './TacticalMap';
import worldDocument from '../docs/worldbuilding.md?raw';

type Page = 'overview' | 'missions' | 'fleet' | 'logs' | 'world' | 'system';
const PHASE: Record<string, string> = {
  available: '等待派遣',
  outbound: '前往任务区',
  working: '执行中',
  decision: '等待调查决策',
  returning: '任务结算 · 返航',
  complete: '已完成',
  failed: '未完成',
};
const STATUS: Record<string, string> = {
  docked: '停靠待命',
  mission: '行动中',
  returning: '返航中',
  holding: '保持位置',
  disabled: '失能 · 拖航中',
  repairing: '维修中',
};
const KIND = { explore: '科学探索', supply: '后勤补给', patrol: '边境巡逻' };
const time = (t: number) =>
  `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}`;

function ShipArt({ ship, large = false }: { ship: Ship; large?: boolean }) {
  return (
    <svg
      className={`ship-art ${large ? 'large' : ''} ${ship.id}`}
      viewBox="0 0 240 150"
      aria-label={`${ship.name} 舰船示意图`}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M30 75H210M120 14V140" opacity=".18" strokeDasharray="3 5" />
        <ellipse cx="120" cy="50" rx={ship.id === 'meridian' ? 27 : 48} ry="27" />
        <ellipse cx="120" cy="50" rx="18" ry="12" />
        <ellipse cx="120" cy="50" rx="5" ry="4" />
        <path d="M106 76L104 125Q120 139 136 125L134 76M104 98L73 116M136 98L167 116M106 107L73 125M134 107L167 125M113 78V116M127 78V116" />
        <path d="M61 67Q67 59 73 67V137H61ZM167 67Q173 59 179 67V137H167Z" />
        <path d="M64 79H70M170 79H176M104 120H136" />
        <path d="M78 40L100 46M140 46L162 40M79 58L100 54M140 54L161 58" opacity=".6" />
      </g>
      <g fill="currentColor">
        <rect x="63" y="66" width="8" height="6" />
        <rect x="169" y="66" width="8" height="6" />
      </g>
    </svg>
  );
}
function Meter({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  return (
    <div className="meter">
      <div>
        <span>{label}</span>
        <strong>
          {Math.ceil(value)}
          <small> / {max}</small>
        </strong>
      </div>
      <div className="meter-track">
        <i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </div>
    </div>
  );
}
function Bar({ children, code = '' }: { children: React.ReactNode; code?: string }) {
  return (
    <div className="section-bar">
      <span>{children}</span>
      <i />
      <b>{code}</b>
    </div>
  );
}

export function App() {
  const [world, setWorld] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>('overview');
  const [selected, setSelected] = useState('verity');
  const [missionId, setMission] = useState<string | null>(null);
  const [route, setRoute] = useState<'safe' | 'fast'>('safe');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [filter, setFilter] = useState('all');
  const worldRef = useRef(world);
  worldRef.current = world;
  const held = useRef(new Set<string>());
  const lastHelm = useRef('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 7000 : 3500);
  }, []);
  const command = useCallback(
    async (c: Command, quiet = false) => {
      try {
        const result = await window.frontier.command(c);
        if (!result.ok || !quiet) notify(result.reason, !result.ok);
        return result;
      } catch {
        notify('无法连接模拟引擎，请保存并重启应用。', true);
        return { ok: false, reason: 'IPC 连接失败' };
      }
    },
    [notify],
  );
  useEffect(() => {
    if (!window.frontier) return;
    window.frontier.getState().then((data) => {
      setWorld(data.state);
      if (data.saveBlocked) notify(data.saveMessage, true);
    });
    return window.frontier.onState(setWorld);
  }, [notify]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !worldRef.current?.manualShipId ||
        /INPUT|SELECT|TEXTAREA/.test((event.target as HTMLElement).tagName)
      )
        return;
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'].includes(event.code)) {
        event.preventDefault();
        held.current.add(event.code);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      held.current.delete(event.code);
    };
    const clear = () => {
      held.current.clear();
      lastHelm.current = '';
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clear);
    const timer = setInterval(() => {
      const w = worldRef.current,
        id = w?.manualShipId;
      if (!id || w?.paused) {
        held.current.clear();
        lastHelm.current = '';
        return;
      }
      const turn = Number(held.current.has('KeyD')) - Number(held.current.has('KeyA'));
      const throttle = Number(held.current.has('KeyW')) - Number(held.current.has('KeyS'));
      const signature = `${id}:${turn}:${throttle}`;
      if (signature !== lastHelm.current) {
        void command({ type: 'helm', shipId: id, turn, throttle }, true);
        lastHelm.current = signature;
      }
      if (held.current.has('Space') && (w.ships.find((s) => s.id === id)?.cooldown ?? 0) <= 0) {
        held.current.delete('Space');
        void command({ type: 'fire', shipId: id }, true);
      }
    }, 80);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
    };
  }, [command]);
  useEffect(() => {
    if (world?.manualShipId) {
      setSelected(world.manualShipId);
      setMission(null);
      setPage('overview');
    }
  }, [world?.manualShipId]);
  if (!world)
    return (
      <div className="loading">
        <span>STARFLEET</span>
        <h1>FRONTIER COMMAND</h1>
        <p>{window.frontier ? '正在建立基地数据连接…' : '请通过 Electron 启动应用：npm start'}</p>
      </div>
    );
  const ship = world.ships.find((s) => s.id === selected)!;
  const inspected = world.missions.find((m) => m.id === missionId);
  const assignment = world.missions.find((m) => m.id === ship.missionId);
  const manual = world.manualShipId === ship.id;
  const active = world.missions.filter((m) =>
    ['outbound', 'working', 'decision', 'returning'].includes(m.phase),
  );
  const selectShip = (id: string) => {
    if (world.manualShipId && world.manualShipId !== id) {
      notify('请先释放当前舰船控制，再切换舰船。', true);
      return;
    }
    setSelected(id);
    setMission(null);
  };
  const openTask = (m: Mission) => {
    setMission(m.id);
    setRoute(m.route);
    setPage('missions');
    if (m.shipId && !world.manualShipId) setSelected(m.shipId);
  };
  const save = async () => {
    const r = await window.frontier.save();
    notify(r.reason, !r.ok);
  };
  const helmButton = (key: string, label: string) => (
    <button
      className="helm-key"
      disabled={world.paused}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        held.current.add(key);
      }}
      onPointerUp={() => held.current.delete(key)}
      onPointerCancel={() => held.current.delete(key)}
    >
      {label}
    </button>
  );

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
          <div className="resource-strip">
            <div>
              <span>就绪舰船</span>
              <b>
                {world.ships.filter((s) => s.status === 'docked').length}
                <small> / 03</small>
              </b>
            </div>
            <div>
              <span>行动配额</span>
              <b>{world.resources.allocation.toString().padStart(3, '0')}</b>
            </div>
            <div>
              <span>科研数据</span>
              <b>{world.resources.science.toString().padStart(3, '0')}</b>
            </div>
            <div>
              <span>区域威胁</span>
              <b className={world.threat > 60 ? 'danger-text' : ''}>
                {world.threat}
                <small> / 100</small>
              </b>
            </div>
            <div>
              <span>补给 / 材料</span>
              <b>
                {world.resources.supplies}
                <small> / {world.resources.materials}</small>
              </b>
            </div>
            <div className="transport">
              <button
                className={world.paused ? 'primary' : ''}
                onClick={() => command({ type: 'pause', paused: !world.paused }, true)}
                aria-label={world.paused ? '继续模拟' : '暂停模拟'}
              >
                {world.paused ? '▶ 继续' : 'Ⅱ 暂停'}
              </button>
              <div>
                {([1, 2, 4] as const).map((speed) => (
                  <button
                    key={speed}
                    disabled={!!world.manualShipId && speed !== 1}
                    className={world.speed === speed ? 'selected' : ''}
                    onClick={() => command({ type: 'speed', speed }, true)}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="work-area">
            <main className="main-view">
              {page === 'overview' && (
                <>
                  <div className="view-heading">
                    <div>
                      <span className="eyebrow">SECTOR TACTICAL DISPLAY</span>
                      <h2>{manual ? '直接操舰' : '曙光边区'}</h2>
                    </div>
                    <span className={`status-pill ${world.paused ? '' : 'live'}`}>
                      <i />
                      {world.paused ? '模拟暂停' : manual ? 'MANUAL CONTROL' : '实时态势'}
                    </span>
                  </div>
                  <div className="map-frame">
                    <div className="map-topline">
                      <span>TACTICAL / 07-ALPHA</span>
                      <span>
                        {world.contacts.length.toString().padStart(2, '0')} CONTACTS ·{' '}
                        {active.length} ACTIVE OPS
                      </span>
                    </div>
                    <TacticalMap
                      world={world}
                      selected={selected}
                      onShip={selectShip}
                      onTarget={(targetId) =>
                        command({ type: 'target', shipId: ship.id, targetId }, true)
                      }
                      manual={manual}
                    />
                    <div className="map-legend">
                      <span>
                        <i className="legend-fleet" />
                        己方舰队
                      </span>
                      <span>
                        <i className="legend-unknown" />
                        接触
                      </span>
                      <span>
                        <i className="legend-border" />
                        边境
                      </span>
                      <span>
                        {manual
                          ? 'W/S 推进 · A/D 转向 · SPACE 开火'
                          : '点击舰船查看状态 · 点击接触选择目标'}
                      </span>
                    </div>
                  </div>
                  <div className="fleet-strip">
                    {world.ships.map((s) => (
                      <button
                        className={`fleet-chip ${s.id} ${selected === s.id ? 'active' : ''}`}
                        key={s.id}
                        onClick={() => selectShip(s.id)}
                      >
                        <span className="chip-top">
                          {s.registry}
                          <i className={s.status === 'docked' ? 'ready-dot' : 'busy-dot'} />
                        </span>
                        <strong>{s.name}</strong>
                        <span>
                          {s.role.split(' · ')[0]} <b>{STATUS[s.status]}</b>
                        </span>
                        <div className="mini-track">
                          <i style={{ width: `${s.hull}%` }} />
                        </div>
                      </button>
                    ))}
                  </div>
                  <Bar code="MISSION CONTROL">待办行动</Bar>
                  <div className="quick-missions">
                    {world.missions
                      .filter((m) => m.phase === 'available')
                      .slice(0, 3)
                      .map((m) => (
                        <button
                          key={m.id}
                          className={`quick-task ${m.kind}`}
                          onClick={() => openTask(m)}
                        >
                          <span>{KIND[m.kind]}</span>
                          <strong>{m.name.split(' · ')[0]}</strong>
                          <b>进入行动 →</b>
                        </button>
                      ))}
                    {!world.missions.some((m) => m.phase === 'available') && (
                      <p className="muted">所有任务已派遣。任务中心可以查看结算并重新开放任务。</p>
                    )}
                  </div>
                </>
              )}
              {page === 'missions' && (
                <>
                  <div className="view-heading">
                    <div>
                      <span className="eyebrow">OPERATIONS MANAGEMENT</span>
                      <h2>任务中心</h2>
                    </div>
                    <span className="mono">06 MISSION WINDOWS</span>
                  </div>
                  <div className="filter-row">
                    {[
                      ['all', '全部'],
                      ['explore', '探索'],
                      ['supply', '补给'],
                      ['patrol', '巡逻'],
                    ].map(([id, label]) => (
                      <button
                        className={filter === id ? 'selected' : ''}
                        key={id}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mission-grid">
                    {world.missions
                      .filter((m) => filter === 'all' || m.kind === filter)
                      .map((m) => (
                        <button
                          className={`mission-card ${m.kind} ${missionId === m.id ? 'active' : ''}`}
                          key={m.id}
                          onClick={() => openTask(m)}
                        >
                          <div className="card-tag">
                            <span>{KIND[m.kind]}</span>
                            <b>{PHASE[m.phase]}</b>
                          </div>
                          <h3>{m.name.split(' · ')[0]}</h3>
                          <p>{m.name.split(' · ')[1]}</p>
                          <p className="brief">{m.brief}</p>
                          <div className="card-data">
                            <span>
                              注意力<b>{m.attention}</b>
                            </span>
                            <span>
                              风险<b>{m.risk}</b>
                            </span>
                          </div>
                          <div className="card-foot">
                            <span>
                              {m.kind === 'explore'
                                ? '科研数据'
                                : m.kind === 'supply'
                                  ? '补给交付 / 配额'
                                  : '情报 / 配额'}
                            </span>
                            <b>{m.phase === 'available' ? '查看与派遣 →' : '行动详情 →'}</b>
                          </div>
                        </button>
                      ))}
                  </div>
                </>
              )}
              {page === 'fleet' && (
                <>
                  <div className="view-heading">
                    <div>
                      <span className="eyebrow">STARBASE SUPPORT SERVICES</span>
                      <h2>舰队管理</h2>
                    </div>
                    <span className="mono">DAWN / SB-A01</span>
                  </div>
                  <div className="stock-grid">
                    <div>
                      <span>维修材料</span>
                      <b>{world.resources.materials}</b>
                      <small>MATERIALS</small>
                    </div>
                    <div>
                      <span>补给库存</span>
                      <b>{world.resources.supplies}</b>
                      <small>SUPPLIES</small>
                    </div>
                    <div>
                      <span>巡逻情报</span>
                      <b>{world.resources.intel}</b>
                      <small>INTELLIGENCE</small>
                    </div>
                  </div>
                  <p className="info-line">
                    常规补给每 180 秒抵达：45 补给 / 15 材料。下一批：
                    {180 - Math.floor(world.time % 180)} 秒。
                  </p>
                  <Bar code="BERTHS 01—03">舰船状态与维修</Bar>
                  <div className="berths">
                    {world.ships.map((s) => (
                      <div className={`berth ${s.id}`} key={s.id}>
                        <ShipArt ship={s} />
                        <div>
                          <span className="mono">{s.registry}</span>
                          <h3>{s.name}</h3>
                          <p>
                            {s.role} · {STATUS[s.status]}
                          </p>
                          <Meter label="舰体" value={s.hull} />
                          <Meter label="护盾" value={s.shield} max={s.maxShield} />
                        </div>
                        <div className="berth-actions">
                          <button onClick={() => selectShip(s.id)}>查看舰船</button>
                          <button
                            disabled={
                              s.status !== 'docked' || (s.hull >= 100 && s.shield >= s.maxShield)
                            }
                            onClick={() => command({ type: 'repair', shipId: s.id })}
                          >
                            安排维修
                          </button>
                          {s.status === 'repairing' && (
                            <small>
                              {s.emergency ? '基础抢修' : '标准维修'} · {Math.ceil(s.repair)} 秒
                            </small>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Bar code="COLONY NETWORK">前哨储备</Bar>
                  <div className="outpost-list">
                    {world.locations
                      .filter((l) => ['colony', 'outpost'].includes(l.kind))
                      .map((l) => (
                        <Meter key={l.id} label={l.name} value={l.supply} />
                      ))}
                  </div>
                </>
              )}
              {page === 'logs' && (
                <>
                  <div className="view-heading">
                    <div>
                      <span className="eyebrow">COMMAND RECORDS</span>
                      <h2>行动日志</h2>
                    </div>
                    <span className="mono">{world.logs.length} RECORDS</span>
                  </div>
                  <p className="muted">
                    记录由模拟引擎产生，保存最近 180 项事件。任务结算包含收益、损伤与原因。
                  </p>
                  <div className="full-logs">
                    {[...world.logs].reverse().map((log) => (
                      <div key={log.id} className={`log-row ${log.level}`}>
                        <time>{time(log.time)}</time>
                        <span>{log.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {page === 'world' && (
                <>
                  <div className="view-heading">
                    <div>
                      <span className="eyebrow">SECTOR ARCHIVES</span>
                      <h2>曙光边区档案</h2>
                    </div>
                    <span className="mono">2368 / ORIGINAL SECTOR</span>
                  </div>
                  <article className="document">
                    {worldDocument
                      .split('\n')
                      .map((line, i) =>
                        line.startsWith('# ') ? (
                          <h2 key={i}>{line.slice(2)}</h2>
                        ) : line.startsWith('## ') ? (
                          <h3 key={i}>{line.slice(3)}</h3>
                        ) : line.startsWith('### ') ? (
                          <h4 key={i}>{line.slice(4)}</h4>
                        ) : line.trim() ? (
                          <p key={i}>{line}</p>
                        ) : null,
                      )}
                  </article>
                </>
              )}
              {page === 'system' && (
                <>
                  <div className="view-heading">
                    <div>
                      <span className="eyebrow">COMPUTER SYSTEMS</span>
                      <h2>系统与操作说明</h2>
                    </div>
                    <span className="mono">LV1 / 1.0.0</span>
                  </div>
                  <Bar code="LOCAL STATE">世界存档</Bar>
                  <p>
                    本地自动保存：重要命令、事件结算、每 10
                    秒模拟时间及正常退出。关闭程序期间世界不推进。重新打开始终暂停。
                  </p>
                  <div className="button-row">
                    <button className="primary" onClick={save}>
                      立即保存
                    </button>
                    <button onClick={() => setConfirmReset(true)}>归档旧存档并重置</button>
                  </div>
                  <Bar code="CONTROL REFERENCE">指挥与操舰</Bar>
                  <div className="help-grid">
                    <div>
                      <h3>高层指挥</h3>
                      <p>
                        在任务中心选择任务、舰船和航线。派遣后点击“继续”。默认规则会保守处理探索与接触，可随时改变方案或召回。
                      </p>
                      <p>“保持位置”会中断自动驾驶，但补给时限仍会推进。可接管后释放并恢复任务。</p>
                    </div>
                    <div>
                      <h3>直接操舰</h3>
                      <p>
                        W/S 增减推进，A/D 转向，点击已识别目标，Space
                        开火。先扫描再警告，往往无需战斗。
                      </p>
                      <p>
                        相位射程 145，舰艏 ±60°，冷却 3
                        秒。接管后速度固定1×，其他舰继续运行。失焦自动暂停。
                      </p>
                    </div>
                    <div>
                      <h3>资源与保障</h3>
                      <p>
                        科研数据、情报和行动配额在 LV1
                        中记录成果，尚不提供升级。补给与材料用于交付和维修。
                      </p>
                      <p>失能后 35 秒拖回基地。材料不足时基础抢修免费，但速度更慢。</p>
                    </div>
                    <div>
                      <h3>项目边界</h3>
                      <p>
                        自动驾驶为确定性规则控制，不是模型 Agent。当前完成
                        LV1；未来模型只能通过合法动作接口参与世界。
                      </p>
                      <p>
                        原创 HTML/CSS LCARS 实现。视觉参考 TheLCARS.com；LCARS 原设计 Michael
                        Okuda。Star Trek 相关标识属于各权利人。
                      </p>
                    </div>
                  </div>
                </>
              )}
            </main>
            <aside className="inspector">
              {inspected ? (
                <>
                  <Bar code={inspected.id.toUpperCase()}>行动简报</Bar>
                  <span className={`task-kind ${inspected.kind}`}>{KIND[inspected.kind]}</span>
                  <h2>{inspected.name}</h2>
                  <p>{inspected.brief}</p>
                  <dl className="spec-list">
                    <div>
                      <dt>当前阶段</dt>
                      <dd>{PHASE[inspected.phase]}</dd>
                    </div>
                    <div>
                      <dt>预计总耗时</dt>
                      <dd>约 2—4 分钟</dd>
                    </div>
                    <div>
                      <dt>现场工作</dt>
                      <dd>{inspected.duration} 秒</dd>
                    </div>
                    <div>
                      <dt>注意力</dt>
                      <dd>{inspected.attention}</dd>
                    </div>
                    <div>
                      <dt>风险</dt>
                      <dd>{inspected.risk}</dd>
                    </div>
                  </dl>
                  <p className="info-line">{inspected.requirement}</p>
                  {inspected.phase === 'available' ? (
                    <>
                      <label className="field-label" htmlFor="assign-ship">
                        执行舰船
                      </label>
                      <select
                        id="assign-ship"
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {world.ships.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · {STATUS[s.status]}
                          </option>
                        ))}
                      </select>
                      {inspected.kind === 'supply' && (
                        <>
                          <label className="field-label">航线方案</label>
                          <div className="segmented">
                            <button
                              className={route === 'safe' ? 'selected' : ''}
                              onClick={() => setRoute('safe')}
                            >
                              安全航线
                            </button>
                            <button
                              className={route === 'fast' ? 'selected' : ''}
                              onClick={() => setRoute('fast')}
                            >
                              快速航线
                            </button>
                          </div>
                          <small className="muted">
                            快速航线更短且航速提高 25%，穿越微陨石带会造成 4—12 点舰体损伤。
                          </small>
                        </>
                      )}
                      <button
                        className="primary wide"
                        disabled={
                          ship.status !== 'docked' || ship.capacity < inspected.cargoRequired
                        }
                        onClick={async () => {
                          const r = await command({
                            type: 'dispatch',
                            shipId: selected,
                            missionId: inspected.id,
                            route,
                          });
                          if (r.ok) {
                            setMission(null);
                            setPage('overview');
                          }
                        }}
                      >
                        授权派遣 →
                      </button>
                      {ship.capacity < inspected.cargoRequired && (
                        <p className="warning-text">货舱不足，请选择子午号。</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p>
                        执行舰船：{world.ships.find((s) => s.id === inspected.shipId)?.name ?? '—'}
                      </p>
                      <Meter
                        label="现场执行"
                        value={Math.min(inspected.work, inspected.duration)}
                        max={inspected.duration}
                      />
                      {inspected.result && <p className="result-box">{inspected.result}</p>}
                      <button
                        className="wide"
                        onClick={() => {
                          setMission(null);
                          setPage('overview');
                        }}
                      >
                        查看战术态势
                      </button>
                      {['complete', 'failed'].includes(inspected.phase) && (
                        <button
                          className="wide"
                          disabled={world.ships.some((s) => s.missionId === inspected.id)}
                          onClick={() => command({ type: 'renew', missionId: inspected.id })}
                        >
                          重新开放行动窗口
                        </button>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <Bar code="VESSEL STATUS">舰船遥测</Bar>
                  <div className="vessel-title">
                    <span>{ship.registry}</span>
                    <b className={manual ? 'warning-text' : ''}>
                      {manual ? '直接操舰' : STATUS[ship.status]}
                    </b>
                  </div>
                  <h2 className="ship-name">{ship.name}</h2>
                  <p className="ship-role">{ship.role}</p>
                  <ShipArt ship={ship} large />
                  <div className="ship-measures">
                    <span>
                      SCI <b>{ship.science}</b>
                    </span>
                    <span>
                      CARGO <b>{ship.capacity}</b>
                    </span>
                    <span>
                      PWR <b>{ship.power}</b>
                    </span>
                  </div>
                  <Meter label="舰体完整度" value={ship.hull} />
                  <Meter label="护盾强度" value={ship.shield} max={ship.maxShield} />
                  <div className="control-source">
                    {manual ? 'COMMANDER / 指挥官直接控制' : 'RULE-BASED / 规则自动驾驶'}
                  </div>
                  {assignment && (
                    <div className="assignment">
                      <span>{PHASE[assignment.phase]}</span>
                      <h3>{assignment.name}</h3>
                      {assignment.deadline > 0 && !assignment.settled && (
                        <small>
                          剩余时限{' '}
                          {Math.max(
                            0,
                            Math.ceil(assignment.deadline - world.time + assignment.started),
                          )}{' '}
                          秒
                        </small>
                      )}
                      {assignment.phase === 'working' && (
                        <Meter
                          label="现场执行"
                          value={Math.min(assignment.work, assignment.duration)}
                          max={assignment.duration}
                        />
                      )}
                      <button className="text-button" onClick={() => openTask(assignment)}>
                        查看行动详情 →
                      </button>
                    </div>
                  )}
                  {assignment?.phase === 'decision' && (
                    <div className="decision-box">
                      <h3>异常调查决策</h3>
                      <p>
                        {ship.science >= 70
                          ? '传感器分析：周期性辐射，近距调查能提升样本精度，但会损伤舰体。'
                          : '传感器分辨率有限。异常存在辐射风险，建议保守调查。'}
                      </p>
                      <button
                        className="primary wide"
                        onClick={() =>
                          command({ type: 'investigate', shipId: ship.id, choice: 'remote' })
                        }
                      >
                        远距调查 · 安全
                      </button>
                      <button
                        className="wide"
                        onClick={() =>
                          command({ type: 'investigate', shipId: ship.id, choice: 'close' })
                        }
                      >
                        近距调查 · 高收益 / 损伤
                      </button>
                    </div>
                  )}
                  {assignment?.kind === 'supply' && assignment.phase === 'outbound' && (
                    <div className="button-row">
                      <button
                        onClick={() => command({ type: 'route', shipId: ship.id, route: 'safe' })}
                      >
                        安全航线
                      </button>
                      <button
                        onClick={() => command({ type: 'route', shipId: ship.id, route: 'fast' })}
                      >
                        快速航线
                      </button>
                    </div>
                  )}
                  {assignment && !assignment.settled && ship.order === 'hold' && (
                    <button
                      className="primary wide"
                      onClick={() => command({ type: 'resume', shipId: ship.id })}
                    >
                      恢复原任务
                    </button>
                  )}
                  <div className="command-grid">
                    {!manual ? (
                      <button
                        className="primary"
                        disabled={
                          !!world.manualShipId || ['disabled', 'repairing'].includes(ship.status)
                        }
                        onClick={() => command({ type: 'takeControl', shipId: ship.id })}
                      >
                        直接操舰
                      </button>
                    ) : (
                      <>
                        <button
                          className="primary"
                          onClick={() =>
                            command({ type: 'releaseControl', shipId: ship.id, resume: true })
                          }
                        >
                          释放 · 恢复任务
                        </button>
                        <button
                          onClick={() =>
                            command({ type: 'releaseControl', shipId: ship.id, resume: false })
                          }
                        >
                          释放 · 保持位置
                        </button>
                      </>
                    )}
                    <button
                      disabled={['docked', 'repairing', 'disabled', 'returning'].includes(
                        ship.status,
                      )}
                      onClick={() => command({ type: 'recall', shipId: ship.id })}
                    >
                      召回基地
                    </button>
                    <button
                      disabled={['docked', 'repairing', 'disabled'].includes(ship.status)}
                      onClick={() => command({ type: 'hold', shipId: ship.id })}
                    >
                      保持位置
                    </button>
                    <button
                      disabled={['repairing', 'disabled'].includes(ship.status)}
                      onClick={() => command({ type: 'scan', shipId: ship.id })}
                    >
                      扫描接触
                    </button>
                  </div>
                  {manual && (
                    <div className="helm">
                      <span>
                        HELM CONTROL <b>{Math.round(ship.throttle * 100)}%</b>
                      </span>
                      <div>
                        {helmButton('KeyW', 'W 推进')}
                        {helmButton('KeyS', 'S 减速')}
                        {helmButton('KeyA', 'A 左转')}
                        {helmButton('KeyD', 'D 右转')}
                      </div>
                      <button
                        className="wide fire-button"
                        disabled={world.paused || ship.cooldown > 0}
                        onClick={() => command({ type: 'fire', shipId: ship.id })}
                      >
                        {ship.cooldown > 0
                          ? `相位阵列冷却 ${ship.cooldown.toFixed(1)}s`
                          : 'SPACE / 发射相位武器'}
                      </button>
                    </div>
                  )}
                  <Bar code={String(world.contacts.length).padStart(2, '0')}>已探测接触</Bar>
                  <div className="contact-list">
                    {world.contacts.map((t) => (
                      <div
                        key={t.id}
                        className={`contact-row ${ship.targetId === t.id ? 'active' : ''}`}
                      >
                        <button
                          onClick={() =>
                            command({ type: 'target', shipId: ship.id, targetId: t.id }, true)
                          }
                          disabled={t.retreating}
                        >
                          <span>{t.identified ? t.faction.toUpperCase() : 'UNKNOWN'}</span>
                          <b>
                            {t.retreating
                              ? '撤离中'
                              : t.hostile
                                ? '敌对'
                                : t.identified
                                  ? '已识别'
                                  : '待扫描'}
                          </b>
                        </button>
                        {ship.targetId === t.id && !t.retreating && (
                          <div className="button-row">
                            <button
                              disabled={!t.identified}
                              onClick={() =>
                                command({ type: 'hail', shipId: ship.id, targetId: t.id })
                              }
                            >
                              警告驱离
                            </button>
                            <button
                              disabled={!t.identified}
                              onClick={() =>
                                command({ type: 'engage', shipId: ship.id, targetId: t.id })
                              }
                            >
                              拦截目标
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {!world.contacts.length && (
                      <p className="empty-state">
                        未发现接触
                        <br />
                        <small>派遣巡逻舰前往边境，或接近后扫描。</small>
                      </p>
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
          <footer className="event-footer">
            <span>
              COMMS
              <br />
              <b>最近事件</b>
            </span>
            <div>
              {world.logs
                .slice(-2)
                .reverse()
                .map((log) => (
                  <p className={log.level} key={log.id}>
                    <time>{time(log.time)}</time>
                    {log.text}
                  </p>
                ))}
            </div>
            <button onClick={() => setPage('logs')}>完整日志 ↗</button>
          </footer>
          <div className="bottom-band">
            <i />
            <span>LCARS / FRONTIER COMMAND · LV1</span>
            <i />
            <span>{world.paused ? 'SIMULATION PAUSED' : 'SIMULATION ACTIVE'}</span>
          </div>
        </div>
      </div>
      {notice && (
        <div role="status" className={`toast ${notice.error ? 'error' : ''}`}>
          <span>{notice.error ? '!' : '✓'}</span>
          {notice.text}
          <button onClick={() => setNotice(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
      {confirmReset && (
        <div className="modal-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            className="lcars-modal"
          >
            <Bar code="COMPUTER">重置世界</Bar>
            <h2 id="reset-title">归档当前世界并重新开始？</h2>
            <p>
              当前存档会保留为带时间戳的归档文件。新世界使用相同初始种子，恢复三艘舰船与六项任务。
            </p>
            <div className="button-row">
              <button onClick={() => setConfirmReset(false)}>取消</button>
              <button
                className="primary"
                onClick={async () => {
                  const r = await window.frontier.reset();
                  notify(r.reason, !r.ok);
                  setConfirmReset(false);
                  setMission(null);
                  setPage('overview');
                }}
              >
                归档并重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
