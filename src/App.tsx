import { useState } from 'react';
import { useFrontier } from './ui/hooks/useFrontier';
import { StrategicMap, type Selection } from './StrategicMap';
import { Inspector } from './ui/Inspector';
import { OrderComposer } from './ui/OrderComposer';
import { LcarsShell } from './ui/components/LcarsShell';
import { LcarsDialog, LcarsButton, LcarsFrame } from './ui/components/Lcars';
import { CommandLost } from './ui/CommandLost';
import { ManagementDrawer } from './ui/ManagementDrawer';
import type { OperationOrder, OrderKind, Point } from './engine/types';
import type { Page } from './ui/types';
import { ConsoleSettings } from './ui/lcars/ConsoleSettings';
import { WorldFeedback } from './ui/lcars/WorldFeedback';
export function App() {
  const { world, timeline, notice, command, save, reset, dismissNotice } = useFrontier();
  const [page, setPage] = useState<Page>('SECTOR'),
    [selection, setSelection] = useState<Selection | null>({ type: 'location', id: 'base' });
  const [focus, setFocus] = useState<{ point: Point; serial: number } | null>(null);
  const [composer, setComposer] = useState<{ kind: OrderKind; existing?: OperationOrder } | null>(
      null,
    ),
    [confirmReset, setConfirmReset] = useState(false),
    [settings, setSettings] = useState(false);
  if (!world)
    return (
      <div className="loading">
        <LcarsFrame title="ESTABLISHING COMMAND LINK">
          <h1>FRONTIER COMMAND</h1>
          <p>正在连接 DAWN STARBASE…</p>
        </LcarsFrame>
      </div>
    );
  const select = (s: Selection, locate = false) => {
    setSelection(s);
    if (locate) {
      const p =
        s.type === 'point'
          ? s
          : s.type === 'ship'
            ? world.ships.find((x) => x.id === s.id)
            : s.type === 'location'
              ? world.locations.find((x) => x.id === s.id)
              : s.type === 'contact'
                ? world.contacts.find((x) => x.id === s.id)
                : s.type === 'loss'
                  ? world.losses.find((x) => x.shipId === s.id)?.position
                  : world.orders.find((x) => x.id === s.id)?.targetLastSeen;
      if (p) setFocus((f) => ({ point: { x: p.x, y: p.y }, serial: (f?.serial ?? 0) + 1 }));
    }
  };
  const locate = (id: string | null) => {
    if (!id) return;
    const type = world.orders.some((x) => x.id === id)
      ? 'order'
      : world.ships.some((x) => x.id === id)
        ? 'ship'
        : world.locations.some((x) => x.id === id)
          ? 'location'
          : world.losses.some((x) => x.shipId === id)
            ? 'loss'
            : 'contact';
    select({ type, id }, true);
  };
  const changedWorld = () => {
    setSelection({ type: 'location', id: 'base' });
    setPage('SECTOR');
    setComposer(null);
    setSettings(false);
    setFocus(null);
  };
  return (
    <>
      <WorldFeedback world={world} branch={timeline.activeId} />
      <LcarsShell
        world={world}
        page={page}
        onPage={(next) => {
          setSettings(false);
          setPage(next);
        }}
        command={command}
        locate={locate}
        contextSerial={
          selection?.type === 'point'
            ? `point:${selection.x}:${selection.y}`
            : `${selection?.type}:${selection?.id}`
        }
        onSettings={() => setSettings(true)}
        overlay={
          settings ? (
            <ConsoleSettings close={() => setSettings(false)} />
          ) : (
            page !== 'SECTOR' && (
              <ManagementDrawer
                page={page}
                world={world}
                timeline={timeline}
                close={() => setPage('SECTOR')}
                select={(s) => {
                  select(s, true);
                  setPage('SECTOR');
                }}
                create={(kind) => setComposer({ kind })}
                command={command}
                save={save}
                newFrontier={() => setConfirmReset(true)}
              />
            )
          )
        }
        inspector={
          <Inspector
            world={world}
            selection={selection}
            select={(s) => select(s)}
            command={command}
            create={(kind) => setComposer({ kind })}
            edit={(existing) => setComposer({ kind: existing.kind, existing })}
          />
        }
      >
        <StrategicMap
          world={world}
          selection={selection}
          onSelect={(s) => select(s)}
          focus={focus}
        />
      </LcarsShell>
      {world.status === 'commandLost' &&
        page !== 'ARCHIVE' &&
        selection?.type !== 'loss' &&
        !confirmReset && (
          <CommandLost
            world={world}
            timeline={timeline}
            command={command}
            onRestored={changedWorld}
            onNewFrontier={() => setConfirmReset(true)}
            onArchive={() => setPage('ARCHIVE')}
          />
        )}
      {composer && world.status === 'active' && (
        <OrderComposer
          world={world}
          kind={composer.kind}
          existing={composer.existing}
          selection={selection}
          command={command}
          onClose={() => {
            setComposer(null);
            setPage('SECTOR');
          }}
        />
      )}
      {confirmReset && (
        <LcarsDialog
          title="BEGIN NEW FRONTIER"
          label="新世界确认"
          onClose={() => setConfirmReset(false)}
        >
          <h2>开始新的边疆世界</h2>
          <p>保留当前时间线和旧版文件，从 DAY 1 00:00 创建独立的新世界。</p>
          <div className="dialog-actions">
            <LcarsButton tone="secondary" onClick={() => setConfirmReset(false)}>
              取消
            </LcarsButton>
            <LcarsButton
              onClick={async () => {
                const r = await reset();
                if (r.ok) {
                  setConfirmReset(false);
                  changedWorld();
                }
              }}
            >
              保留记录并创建新世界
            </LcarsButton>
          </div>
        </LcarsDialog>
      )}
      {notice && (
        <div className={'notification ' + (notice.error ? 'error' : '')} role="status">
          <span>{notice.text}</span>
          <LcarsButton tone="secondary" onClick={dismissNotice} aria-label="关闭通知">
            CLOSE
          </LcarsButton>
        </div>
      )}
    </>
  );
}
