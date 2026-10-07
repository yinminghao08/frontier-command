import { useEffect, useRef, useState } from 'react';
import type { CommandResult, Snapshot } from '../engine/types';
import type { SaveAction, SaveCatalog, TimelineStatus } from '../engine/timeline';
import { gameCalendar } from '../engine/clock';
import type { CommandSender } from './types';
import type { Selection } from '../StrategicMap';
import {
  LcarsButton,
  LcarsDialog,
  LcarsDrawer,
  LcarsField,
  LcarsTextBar,
} from './components/Lcars';

type Form = { type: 'create' | 'copy' | 'rename' | 'delete'; id?: string; name: string };
const date = (value: number | null) =>
  value === null ? '未知' : new Date(value).toLocaleString('zh-CN');
const gameDate = (tick: number) => {
  const cal = gameCalendar(tick);
  return `DAY ${cal.day} ${String(cal.hour).padStart(2, '0')}:${String(cal.minute).padStart(2, '0')}`;
};
export function SaveManager({
  world,
  timeline,
  catalog,
  protectedCurrent,
  action,
  save,
  command,
  close,
  changed,
  select,
  onBusyChange,
  initialCreate = false,
}: {
  world: Snapshot;
  timeline: TimelineStatus;
  catalog: SaveCatalog;
  protectedCurrent: boolean;
  action: (action: SaveAction) => Promise<CommandResult>;
  save: () => Promise<CommandResult>;
  command: CommandSender;
  close: () => void;
  changed: () => void;
  select: (selection: Selection) => void;
  onBusyChange: (busy: boolean) => void;
  initialCreate?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(catalog.activeId);
  const [form, setForm] = useState<Form | null>(
    initialCreate ? { type: 'create', name: '新边疆' } : null,
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!catalog.saves.some((s) => s.id === selectedId))
      setSelectedId(catalog.activeId ?? catalog.saves[0]?.id ?? null);
  }, [catalog, selectedId]);
  const selected = catalog.saves.find((s) => s.id === selectedId);
  const current = selected?.id === catalog.activeId;
  const available = selected && ['ready', 'backup'].includes(selected.availability);
  const run = async (operation: () => Promise<CommandResult>, onSuccess?: () => void) => {
    if (pending.current) return;
    pending.current = true;
    onBusyChange(true);
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (result.ok) onSuccess?.();
      else setError(result.reason);
    } catch {
      setError('操作失败，请重试；当前存档保留。');
    } finally {
      pending.current = false;
      onBusyChange(false);
      setBusy(false);
    }
  };
  const openForm = (type: Form['type']) => {
    setError('');
    setForm({
      type,
      id: selected?.id,
      name:
        type === 'create'
          ? '新边疆'
          : type === 'copy'
            ? (
                (catalog.saves.find((s) => s.id === catalog.activeId)?.name ?? '边疆') + ' 副本'
              ).slice(0, 40)
            : (selected?.name ?? ''),
    });
  };
  const submit = () => {
    if (!form) return;
    const request: SaveAction =
      form.type === 'create' || form.type === 'copy'
        ? { type: form.type, name: form.name.trim() }
        : form.type === 'rename'
          ? { type: 'rename', id: form.id!, name: form.name.trim() }
          : { type: 'delete', id: form.id! };
    void run(
      () => action(request),
      () => {
        setForm(null);
        if (request.type === 'create' || request.type === 'copy') changed();
      },
    );
  };
  return (
    <>
      <LcarsDrawer
        title="SAVE MANAGER / 存档管理器"
        label="ARCHIVE 工作面板"
        onClose={() => {
          if (!busy) close();
        }}
        className="save-manager"
      >
        <div className="inline-actions save-toolbar">
          <LcarsButton disabled={busy || catalog.blocked} onClick={() => openForm('create')}>
            新建存档
          </LcarsButton>
          <LcarsButton
            disabled={busy || catalog.blocked}
            onClick={() =>
              void run(() => action({ type: 'demo', name: 'AGENT DEMO / v11 演示' }), changed)
            }
          >
            AGENT DEMO / 演示存档
          </LcarsButton>
          <LcarsButton
            disabled={busy || catalog.blocked || protectedCurrent || !catalog.activeId}
            onClick={() => openForm('copy')}
          >
            复制当前进度
          </LcarsButton>
        </div>
        <p className="muted">世界已暂停。关闭或切换存档后，请手动继续模拟。</p>
        <p className="muted">
          Agent Demo 会建立独立存档：已确认虫洞、真实货运与护航、聊天记录和即将毕业的学员。继续 16×
          模拟即可观察结果。
        </p>
        {catalog.message && <p role="alert">{catalog.message}</p>}
        {protectedCurrent && (
          <p role="alert">当前存档受保护，原文件保留。请选择其他有效存档或新建世界。</p>
        )}
        {error && !form && (
          <p role="alert" className="save-error">
            {error}
          </p>
        )}
        <div className="save-workspace" aria-busy={busy}>
          <section className="save-list" aria-label="存档列表">
            <LcarsTextBar>存档列表 / {catalog.saves.length}</LcarsTextBar>
            {catalog.saves.length === 0 && <p>没有可管理的存档。</p>}
            {catalog.saves.map((s) => (
              <LcarsButton
                key={s.id}
                data-save-id={s.id}
                shape="rail"
                tone={s.id === selectedId ? 'primary' : 'secondary'}
                aria-pressed={s.id === selectedId}
                disabled={busy}
                className="save-row"
                onClick={() => {
                  setSelectedId(s.id);
                  setError('');
                }}
              >
                <strong>
                  {s.name}
                  {s.id === catalog.activeId ? ' · 当前' : ''}
                </strong>
                <span>
                  {s.tick === null ? '日期未知' : gameDate(s.tick)} ·{' '}
                  {s.status === 'commandLost'
                    ? '指挥失效'
                    : s.status === 'active'
                      ? '进行中'
                      : '不可读取'}
                </span>
                <small>
                  {s.id} · {date(s.savedAt)}
                </small>
                {s.reason && <span>{s.reason}</span>}
              </LcarsButton>
            ))}
          </section>
          <section className="save-detail" aria-label="存档详情" key={selected?.id ?? 'empty'}>
            <LcarsTextBar>存档详情</LcarsTextBar>
            {selected ? (
              <>
                <h2>{selected.name}</h2>
                <dl>
                  <dt>存档 ID</dt>
                  <dd>{selected.id}</dd>
                  <dt>游戏日期</dt>
                  <dd>{selected.tick === null ? '未知' : gameDate(selected.tick)}</dd>
                  <dt>最近保存</dt>
                  <dd>{date(selected.savedAt)}</dd>
                  <dt>世界状态</dt>
                  <dd>
                    {selected.status === 'commandLost'
                      ? '指挥失效 · 失败记录已封存'
                      : selected.status === 'active'
                        ? '进行中'
                        : '不可读取'}
                  </dd>
                  <dt>永久损失</dt>
                  <dd>{selected.lossCount ?? '未知'}</dd>
                  {selected.parent && (
                    <>
                      <dt>来源分支</dt>
                      <dd>
                        {selected.parent.id} · DAY {selected.parent.day}
                      </dd>
                    </>
                  )}
                </dl>
                {selected.reason && <p>{selected.reason}</p>}
                <div className="inline-actions">
                  <LcarsButton
                    disabled={
                      busy || catalog.blocked || !available || (current && protectedCurrent)
                    }
                    onClick={() =>
                      void run(() => action({ type: 'load', id: selected.id }), changed)
                    }
                  >
                    {current ? '返回当前存档' : '开始 / 加载'}
                  </LcarsButton>
                  {current && (
                    <LcarsButton
                      disabled={busy || protectedCurrent || catalog.blocked}
                      onClick={() => void run(save)}
                    >
                      立即保存
                    </LcarsButton>
                  )}
                  <LcarsButton
                    disabled={busy || catalog.blocked}
                    onClick={() => openForm('rename')}
                  >
                    重命名
                  </LcarsButton>
                  <LcarsButton
                    tone="danger"
                    disabled={busy || catalog.blocked || current}
                    onClick={() => openForm('delete')}
                  >
                    删除存档
                  </LcarsButton>
                </div>
                {current && <p className="muted">当前存档不能删除，请先切换到其他存档。</p>}
                {current && !protectedCurrent && (
                  <>
                    <LcarsButton
                      disabled={busy || timeline.previousDay === null || catalog.blocked}
                      onClick={() =>
                        void run(async () => {
                          const result = await command({ type: 'restorePreviousDay' });
                          if (result.ok) await action({ type: 'closeManager' });
                          return result;
                        }, changed)
                      }
                    >
                      从昨日建立独立存档
                    </LcarsButton>
                    <details className="save-history">
                      <summary>永久损失 / {world.losses.length}</summary>
                      {world.losses.map((loss) => (
                        <LcarsButton
                          key={loss.shipId}
                          shape="rail"
                          className="record-row"
                          disabled={busy}
                          onClick={() => select({ type: 'loss', id: loss.shipId })}
                        >
                          {loss.name} · {loss.reason}
                        </LcarsButton>
                      ))}
                      {world.losses.length === 0 && <p>没有永久损失。</p>}
                    </details>
                    <details className="save-history">
                      <summary>世界历史 / {world.history.length}</summary>
                      {[...world.history].reverse().map((h) => (
                        <p key={h.id}>
                          <small>
                            {Math.floor(h.time)}m / {h.kind}
                          </small>{' '}
                          {h.text}
                        </p>
                      ))}
                    </details>
                  </>
                )}
              </>
            ) : (
              <p>请选择存档。</p>
            )}
          </section>
        </div>
      </LcarsDrawer>
      {form && (
        <LcarsDialog
          title={
            form.type === 'delete'
              ? '删除存档确认'
              : form.type === 'rename'
                ? '重命名存档'
                : '新建存档'
          }
          label={form.type === 'delete' ? '删除存档确认' : '存档编辑'}
          onClose={() => {
            if (!busy) {
              setForm(null);
              setError('');
            }
          }}
        >
          {form.type === 'delete' ? (
            <>
              <h2>{form.name}</h2>
              <p>确定删除此存档？删除不可恢复。其他存档及其可用历史快照会保留。</p>
              <p>{form.id}</p>
            </>
          ) : (
            <>
              {(form.type === 'create' || form.type === 'copy') && (
                <LcarsField>
                  创建方式
                  <select
                    aria-label="创建方式"
                    value={form.type}
                    disabled={busy}
                    onChange={(e) =>
                      setForm({ ...form, type: e.target.value as 'create' | 'copy' })
                    }
                  >
                    <option value="create">全新世界 · DAY 1</option>
                    <option value="copy" disabled={protectedCurrent || !catalog.activeId}>
                      复制当前进度
                    </option>
                  </select>
                </LcarsField>
              )}
              <LcarsField>
                存档名称
                <input
                  aria-label="存档名称"
                  autoFocus
                  value={form.name}
                  maxLength={40}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && form.name.trim()) submit();
                  }}
                />
              </LcarsField>
              <p className="muted">1–40 个字符；允许同名，内部 ID 保持独立。</p>
              {form.type === 'copy' && <p>完整复制当前世界与历史。失败世界仍保持指挥失效。</p>}
            </>
          )}
          {error && (
            <p role="alert" className="save-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <LcarsButton
              tone="secondary"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError('');
              }}
            >
              取消
            </LcarsButton>
            <LcarsButton
              tone={form.type === 'delete' ? 'danger' : 'primary'}
              disabled={busy || (form.type !== 'delete' && !form.name.trim())}
              onClick={submit}
            >
              {busy
                ? '正在提交…'
                : form.type === 'delete'
                  ? '确认删除'
                  : form.type === 'rename'
                    ? '保存名称'
                    : '创建并进入'}
            </LcarsButton>
          </div>
        </LcarsDialog>
      )}
    </>
  );
}
