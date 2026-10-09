import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Point, Snapshot } from '../engine/types';
import type { CommandSender } from './types';
import { COMMAND_CHANNEL } from '../engine/chat';
import { gameCalendar } from '../engine/clock';
import { LcarsButton, LcarsFrame } from './components/Lcars';
import { AGENT_STATUS } from './AgentsView';
import { useLcars } from './lcars/LcarsProvider';
import { AgentRequests } from './AgentRequests';
import { AgentCallStatus } from './AgentRuntime';
const POSITION_KEY = 'frontier.comms.position.v1';
const clamp = (p: Point): Point => {
  const box = document.querySelector('.communications-launcher')?.getBoundingClientRect();
  return {
    x: Math.max(8, Math.min(innerWidth - (box?.width ?? 116) - 8, p.x)),
    y: Math.max(8, Math.min(innerHeight - (box?.height ?? 58) - 8, p.y)),
  };
};
function initialPosition(): Point {
  try {
    const p = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return clamp(p);
  } catch {
    /* Use default position. */
  }
  return clamp({ x: innerWidth - 156, y: innerHeight - 160 });
}
export function Communications({
  world,
  command,
  requested,
}: {
  world: Snapshot;
  command: CommandSender;
  requested: { channelId: string; serial: number } | null;
}) {
  const { audio, preferences } = useLcars();
  const [position, setPosition] = useState(initialPosition),
    [open, setOpen] = useState(false),
    [channelId, setChannelId] = useState(COMMAND_CHANNEL);
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [sending, setSending] = useState(false),
    [limit, setLimit] = useState(100);
  const [showRequests, setShowRequests] = useState(false),
    [controlMode, setControlMode] = useState<'voluntary' | 'direct'>('voluntary');
  const [toast, setToast] = useState<Snapshot['chatMessages'][number] | null>(null);
  const drag = useRef<{ origin: Point; position: Point; moved: boolean } | null>(null),
    dragged = useRef(false);
  const lastMessage = useRef(world.chatMessages.at(-1)?.id ?? 0),
    toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const read = useRef(''),
    end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (requested) {
      setChannelId(requested.channelId);
      setShowRequests(false);
      setOpen(true);
    }
  }, [requested]);
  useEffect(() => {
    const resize = () => setPosition(clamp);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      /* Position still works for this session. */
    }
  }, [position]);
  useEffect(() => {
    setPosition(clamp);
  }, [preferences.textScale, preferences.interfaceZoom]);
  const channel = world.chatChannels.find((c) => c.id === channelId) ?? world.chatChannels[0];
  const messages = world.chatMessages.filter((m) => m.channelId === channel.id);
  const last = messages.at(-1)?.id ?? 0;
  const unread = (id: string) => {
    const ch = world.chatChannels.find((c) => c.id === id)!;
    return world.chatMessages.filter(
      (m) => m.channelId === id && m.sender !== world.commander.id && m.id > ch.readThrough,
    ).length;
  };
  const totalUnread = world.chatChannels.reduce((n, c) => n + unread(c.id), 0);
  useEffect(() => {
    if (!open || last <= channel.readThrough) return;
    const serial = channel.id + ':' + last;
    if (read.current === serial) return;
    read.current = serial;
    void window.frontier.command({ type: 'readChat', channelId: channel.id, throughId: last });
  }, [open, channel.id, channel.readThrough, last]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, channel.id, last]);
  useEffect(() => {
    setLimit(100);
    if (open) input.current?.focus();
  }, [open, channel.id]);
  useEffect(() => {
    const latest = [...world.chatMessages]
      .reverse()
      .find(
        (m) => m.id > lastMessage.current && m.sender !== world.commander.id && m.kind !== 'report',
      );
    lastMessage.current = world.chatMessages.at(-1)?.id ?? lastMessage.current;
    if (!latest) return;
    audio.play(latest.kind === 'danger' ? 'alert' : 'action', 'chat:' + latest.id);
    if (open && channel.id === latest.channelId) return;
    setToast(latest);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, [world.chatMessages, audio, open, channel.id]);
  const moveButton = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = { x: event.clientX - d.origin.x, y: event.clientY - d.origin.y };
    if (Math.hypot(delta.x, delta.y) > 4) d.moved = true;
    if (d.moved) setPosition(clamp({ x: d.position.x + delta.x, y: d.position.y + delta.y }));
  };
  const draft = drafts[channel.id] ?? '';
  const setDraft = (content: string) => setDrafts((d) => ({ ...d, [channel.id]: content }));
  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    const sentChannel = channel.id;
    try {
      const result = await command(
        { type: 'sendChat', channelId: sentChannel, content, mentions: [], controlMode },
        true,
      );
      if (result.ok) setDrafts((d) => ({ ...d, [sentChannel]: '' }));
    } finally {
      setSending(false);
    }
  };
  const name = (id: string) =>
    id === 'system'
      ? 'SYSTEM / 引擎报告'
      : id === world.commander.id
        ? 'ADMIRAL'
        : (world.agents.find((a) => a.id === id)?.name ?? id);
  const waiting = world.agents.filter(
    (a) =>
      channel.members.includes(a.id) &&
      (a.status === 'waiting' ||
        world.chatMessages.some(
          (m) => m.channelId === channelId && m.responses?.[a.id] === 'pending',
        )),
  );
  const textUnit = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const panelWidth = Math.min(Math.max(850, textUnit * 45), innerWidth - 24),
    panelHeight = Math.min(Math.max(680, textUnit * 28), innerHeight - 32);
  const windowPosition = {
    left: Math.max(12, Math.min(innerWidth - panelWidth - 12, position.x - panelWidth + 116)),
    top: Math.max(12, Math.min(innerHeight - panelHeight - 12, position.y - panelHeight - 8)),
    width: panelWidth,
    height: panelHeight,
  };
  return (
    <>
      <LcarsButton
        className="communications-launcher"
        data-testid="chat-launcher"
        aria-label="打开舰队通讯（可拖动）"
        aria-expanded={open}
        style={{ left: position.x, top: position.y }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragged.current = false;
          drag.current = { origin: { x: event.clientX, y: event.clientY }, position, moved: false };
        }}
        onPointerMove={moveButton}
        onPointerUp={(event) => {
          dragged.current = drag.current?.moved ?? false;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          dragged.current = true;
        }}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          setOpen((o) => !o);
          setToast(null);
          audio.play('navigation');
        }}
      >
        CHAT<span>通讯</span>
        {totalUnread > 0 && (
          <span className="chat-unread-badge" aria-label={totalUnread + ' 条未读消息'}>
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </LcarsButton>
      {open && (
        <div
          className="communications-window"
          style={windowPosition}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              e.stopPropagation();
            }
          }}
        >
          {totalUnread > 0 && (
            <span
              className="chat-window-unread chat-unread-badge"
              aria-label={totalUnread + ' 条未读消息'}
            >
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
          <LcarsFrame
            role="dialog"
            aria-label="舰队通讯"
            title="SUBSPACE COMMUNICATIONS / 亚空间通讯"
            className="communications-frame"
            onClose={() => setOpen(false)}
          >
            <div className={'chat-workspace' + (panelWidth / textUnit < 38 ? ' compact' : '')}>
              <nav className="chat-channels" aria-label="通讯会话">
                <LcarsButton
                  shape="rail"
                  aria-pressed={showRequests}
                  onClick={() => setShowRequests(true)}
                >
                  REQUESTS / 待处理请求
                </LcarsButton>
                {world.chatChannels.map((ch) => {
                  const recent = [...world.chatMessages]
                      .reverse()
                      .find((m) => m.channelId === ch.id),
                    agent = world.agents.find((a) => ch.members.includes(a.id));
                  const count = unread(ch.id);
                  return (
                    <LcarsButton
                      key={ch.id}
                      className="chat-channel-row"
                      shape="rail"
                      aria-pressed={channel.id === ch.id}
                      data-channel-id={ch.id}
                      onClick={() => {
                        setChannelId(ch.id);
                        setShowRequests(false);
                      }}
                    >
                      <strong>
                        {ch.kind === 'reports'
                          ? 'SYSTEM REPORTS / 系统报告'
                          : ch.kind === 'command'
                            ? 'FRONTIER COMMAND'
                            : 'Admiral ↔ ' + agent?.name}
                      </strong>
                      {ch.kind === 'private' && agent && (
                        <small>{AGENT_STATUS[agent.status]} · {world.ships.find(s=>s.id===agent.assignedShipId)?.name??'未分配舰船'}</small>
                      )}
                      <small className="chat-preview">
                        {recent ? name(recent.sender) + ': ' + recent.content : '频道就绪'}
                      </small>
                      {count > 0 && <b className="chat-channel-unread">{count}</b>}
                    </LcarsButton>
                  );
                })}
              </nav>
              {showRequests ? (
                <div className="chat-conversation chat-request-scroll">
                  <AgentRequests world={world} command={command} />
                </div>
              ) : (
                <section
                  className="chat-conversation"
                  aria-label={
                    channel.kind !== 'private' ? channel.name : 'Admiral ↔ ' + channel.name
                  }
                >
                  <header className="chat-conversation-heading">
                    <strong>
                      {channel.kind === 'reports'
                        ? 'SYSTEM REPORTS / 系统报告'
                        : channel.kind === 'command'
                          ? 'FRONTIER COMMAND'
                          : 'Admiral ↔ ' + channel.name}
                    </strong>
                    <small>{channel.kind==='private'?(world.ships.find(s=>s.id===world.agents.find(a=>channel.members.includes(a.id))?.assignedShipId)?.name??'未分配舰船'):''}</small>
                    <small>
                      {channel.members.length} MEMBERS / {messages.length} TRANSMISSIONS
                    </small>
                  </header>
                  <div
                    className="chat-transcript"
                    role="log"
                    aria-label="聊天记录"
                    aria-live="polite"
                  >
                    {messages.length > limit && (
                      <LcarsButton tone="secondary" onClick={() => setLimit((n) => n + 100)}>
                        加载更早消息
                      </LcarsButton>
                    )}
                    {!messages.length && (
                      <p className="muted">
                        频道已建立。可以向 Agent 下达意图、讨论风险或请求协作。
                      </p>
                    )}
                    {messages.slice(-limit).map((m) => {
                      const cal = gameCalendar(Math.round(m.time * 10));
                      return (
                        <article
                          className={'chat-message ' + m.kind}
                          key={m.id}
                          data-message-id={m.id}
                          data-sender={m.sender}
                        >
                          <header>
                            <b>{name(m.sender)}</b>
                            <time>
                              DAY {cal.day} / {String(cal.hour).padStart(2, '0')}:
                              {String(cal.minute).padStart(2, '0')}
                            </time>
                            <small>{m.kind.toUpperCase()}</small>
                            <small>
                              {m.origin === 'engine'
                                ? 'SYSTEM'
                                : m.origin === 'agent'
                                  ? 'AGENT'
                                  : m.origin === 'admiral'
                                    ? 'ADMIRAL'
                                    : 'ARCHIVE'}
                            </small>
                            {m.replyTo && (
                              <small>
                                RE #{m.replyTo}
                                {m.purpose === 'acknowledgement' ? ' / ACK' : ''}
                              </small>
                            )}
                          </header>
                          <p>{highlightMentions(m.content, world)}</p>
                          {m.responses &&
                            Object.entries(m.responses).map(([agentId, status]) => (
                              <div
                                key={agentId}
                                className="inline-actions"
                                aria-label="消息回复状态"
                              >
                                <small>
                                  {name(agentId)} ·{' '}
                                  {
                                    {
                                      pending: '待回复',
                                      replied: '已回复',
                                      failed: '回复失败',
                                      superseded: '已被新指令替代',
                                      cancelled: '已取消',
                                    }[status]
                                  }
                                </small>
                                {status === 'pending' && (
                                  <LcarsButton
                                    tone="secondary"
                                    onClick={() =>
                                      void command(
                                        { type: 'cancelAgentReply', agentId, messageId: m.id },
                                        true,
                                      )
                                    }
                                  >
                                    取消等待
                                  </LcarsButton>
                                )}
                                {status === 'failed' && (
                                  <LcarsButton
                                    onClick={() =>
                                      void command(
                                        { type: 'retryAgent', agentId, messageId: m.id },
                                        true,
                                      )
                                    }
                                  >
                                    重试回复
                                  </LcarsButton>
                                )}
                              </div>
                            ))}
                        </article>
                      );
                    })}
                    <div ref={end} />
                  </div>
                  <div className={'chat-typing' + (waiting.length ? '' : ' idle')} role="status">
                    {waiting.length
                      ? waiting.map((a) => (
                          <span key={a.id}>
                            {a.name} <AgentCallStatus agentId={a.id} status="waiting" />{' '}
                          </span>
                        ))
                      : 'SUBSPACE LINK / 频道在线'}
                  </div>
                  {channel.kind === 'reports' ? (
                    <p className="muted">引擎自动报告 · 不调用模型 · 此频道只读</p>
                  ) : (
                    <form
                      className="chat-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <select
                        aria-label="通讯任务模式"
                        value={controlMode}
                        onChange={(event) =>
                          setControlMode(event.target.value as typeof controlMode)
                        }
                      >
                        <option value="voluntary">Agent 判断后执行</option>
                        <option value="direct">Admiral 直接接管</option>
                      </select>
                      <textarea
                        ref={input}
                        aria-label="通讯消息"
                        rows={panelWidth / textUnit < 38 ? 1 : 2}
                        maxLength={1200}
                        value={draft}
                        disabled={sending || world.status !== 'active'}
                        placeholder="发送意图、询问任务，或 @AgentName…"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <LcarsButton
                        disabled={!draft.trim() || sending || world.status !== 'active'}
                        onClick={() => void send()}
                      >
                        SEND / 发送
                      </LcarsButton>
                      {draft.includes('@') && (
                        <div className="chat-mentions" aria-label="提及 Agent">
                          {world.agents
                            .filter((a) => channel.members.includes(a.id))
                            .map((a) => (
                              <LcarsButton
                                key={a.id}
                                tone="secondary"
                                onClick={() => {
                                  setDraft(draft.replace(/@[^@\s]*$/, '@' + a.name + ' '));
                                  input.current?.focus();
                                }}
                              >
                                @{a.name}
                              </LcarsButton>
                            ))}
                        </div>
                      )}
                    </form>
                  )}
                </section>
              )}
            </div>
          </LcarsFrame>
        </div>
      )}
      {toast && (
        <div className="chat-notification" role="status">
          <LcarsButton
            shape="rail"
            onClick={() => {
              setChannelId(toast.channelId);
              setShowRequests(false);
              setOpen(true);
              setToast(null);
            }}
          >
            <b>INCOMING / {name(toast.sender)}</b>
            <span>{toast.content.slice(0, 100)}</span>
          </LcarsButton>
        </div>
      )}
    </>
  );
}
function highlightMentions(content: string, world: Snapshot) {
  const names = [...world.agents.map((a) => a.name), 'Admiral']
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(@(?:' + names.join('|') + ')(?=$|[\\s，,。:：!！?？]))', 'giu');
  return content
    .split(regex)
    .map((part, index) => (part.startsWith('@') ? <mark key={index}>{part}</mark> : part));
}
