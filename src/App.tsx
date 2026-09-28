import { useEffect, useState } from 'react';
import type { Mission } from './engine/types';
import type { Page } from './ui/types';
import { useFrontier } from './ui/hooks/useFrontier';
import { useHelmControls } from './ui/hooks/useHelmControls';
import { OverviewPage } from './ui/pages/OverviewPage';
import { MissionsPage } from './ui/pages/MissionsPage';
import { FleetPage } from './ui/pages/FleetPage';
import { LogsPage } from './ui/pages/LogsPage';
import { ArchivesPage } from './ui/pages/ArchivesPage';
import { SystemPage } from './ui/pages/SystemPage';
import { LcarsShell } from './ui/components/LcarsShell';
import { MissionInspector } from './ui/components/MissionInspector';
import { ShipInspector } from './ui/components/ShipInspector';
import { Notification } from './ui/components/Notification';
import { ResetDialog } from './ui/components/ResetDialog';

export function App() {
  const { world, notice, command, notify, save, reset, dismissNotice } = useFrontier();
  const helmButton = useHelmControls(world, command);
  const [page, setPage] = useState<Page>('overview');
  const [selected, setSelected] = useState('verity');
  const [missionId, setMission] = useState<string | null>(null);
  const [route, setRoute] = useState<'safe' | 'fast'>('safe');
  const [confirmReset, setConfirmReset] = useState(false);
  const [filter, setFilter] = useState('all');
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
  const onReset = async () => {
    await reset();
    setConfirmReset(false);
    setMission(null);
    setPage('overview');
  };
  const onCancel = () => setConfirmReset(false);
  const onDismiss = dismissNotice;

  return (
    <LcarsShell
      world={world}
      page={page}
      setPage={setPage}
      selected={selected}
      selectShip={selectShip}
      setMission={setMission}
      manual={manual}
      command={command}
      inspector={
        inspected ? (
          <MissionInspector
            world={world}
            inspected={inspected}
            selected={selected}
            setSelected={setSelected}
            route={route}
            setRoute={setRoute}
            ship={ship}
            command={command}
            setMission={setMission}
            setPage={setPage}
          />
        ) : (
          <ShipInspector
            world={world}
            ship={ship}
            manual={manual}
            assignment={assignment}
            openTask={openTask}
            command={command}
            helmButton={helmButton}
          />
        )
      }
      overlays={
        <>
          {notice && <Notification notice={notice} onDismiss={onDismiss} />}
          {confirmReset && <ResetDialog onCancel={onCancel} onReset={onReset} />}
        </>
      }
    >
      {page === 'overview' && (
        <OverviewPage
          world={world}
          manual={manual}
          active={active}
          selected={selected}
          selectShip={selectShip}
          command={command}
          ship={ship}
          openTask={openTask}
        />
      )}
      {page === 'missions' && (
        <MissionsPage
          world={world}
          filter={filter}
          setFilter={setFilter}
          missionId={missionId}
          openTask={openTask}
        />
      )}
      {page === 'fleet' && <FleetPage world={world} selectShip={selectShip} command={command} />}
      {page === 'logs' && <LogsPage world={world} />}
      {page === 'world' && <ArchivesPage />}
      {page === 'system' && <SystemPage save={save} setConfirmReset={setConfirmReset} />}
    </LcarsShell>
  );
}
