import type { SimulationEngine } from './engine';
import type { Observation, Opportunity, Snapshot } from './types';
import { visibleIntel } from './sensors';
import { frontierSectors, sectorId } from './world-generation';
import { available } from './command-system';
export function opportunities(e: SimulationEngine): Opportunity[] {
  const w = e.state,
    result: Opportunity[] = [];
  for (const s of frontierSectors(w.sectors))
    result.push({
      id: 'explore:' + sectorId(s),
      kind: 'exploration',
      targetId: sectorId(s),
      text: 'UNKNOWN SPACE ' + s.q + '/' + s.r + ' · 可测绘',
    });
  for (const b of w.bodies.filter((b) => b.discovered && b.kind === 'resource' && b.remaining > 0))
    result.push({
      id: 'mine:' + b.id,
      kind: 'mining',
      targetId: b.id,
      text: b.name + (b.survey < 2 ? ' · 需要近距调查' : ' · 可采集/建设矿场'),
    });
  for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)) {
    if (l.kind === 'mine' && l.stock.materials >= 10)
      result.push({
        id: 'freight:' + l.id,
        kind: 'logistics',
        targetId: l.id,
        text: l.name + ' · ' + Math.floor(l.stock.materials) + ' Materials 等待运输',
      });
    if (l.id !== 'base' && l.stock.supplies < 15)
      result.push({
        id: 'supply:' + l.id,
        kind: 'logistics',
        targetId: l.id,
        text: l.name + ' · Supplies 不足',
      });
    if (l.distress && w.time - l.attackedAt <= 30)
      result.push({
        id: 'defend:' + l.id,
        kind: 'security',
        targetId: l.id,
        text: l.name + ' · 请求防卫',
      });
  }
  for (const c of visibleIntel(w).filter((c) => c.live && c.hostile))
    result.push({
      id: 'threat:' + c.id,
      kind: 'security',
      targetId: c.id,
      text: '已观测敌对接触 · ' + (c.name ?? c.id),
    });
  for (const p of w.projects.filter((p) => !p.complete))
    result.push({
      id: 'build:' + p.id,
      kind: 'construction',
      targetId: p.id,
      text: p.name + ' · 等待现场物资/施工',
    });
  return result;
}
export function snapshot(this: SimulationEngine): Snapshot {
  const w = this.state,
    bodies = w.bodies.filter((b) => b.discovered),
    ids = new Set(bodies.map((b) => b.id));
  return structuredClone({
    version: w.version,
    tick: w.tick,
    time: w.time,
    paused: w.paused,
    speed: w.speed,
    status: w.status,
    pauseReasons: w.pauseReasons,
    commander: w.commander,
    operators: w.operators,
    assignments: w.assignments,
    losses: w.losses,
    ships: w.ships,
    contacts: visibleIntel(w),
    sectors: w.sectors.filter((s) => s.discovered),
    systems: w.systems
      .filter((s) => s.discovered)
      .map((s) => ({ ...s, bodyIds: s.bodyIds.filter((id) => ids.has(id)) })),
    bodies: bodies.map((b) =>
      b.survey >= 2 ? b : { ...b, remaining: 0, richness: 0, hazard: 0, specialClaimed: false },
    ),
    locations: w.locations
      .filter((l) => l.owner === 'starfleet' || l.discovered)
      .map((l) =>
        l.owner === 'starfleet'
          ? l
          : {
              ...l,
              stock: { materials: 0, supplies: 0, photon: 0, quantum: 0, specialFinds: 0 },
              core: 0,
              production: 0,
            },
      ),
    projects: w.projects,
    jobs: w.jobs,
    wrecks: w.wrecks.filter((x) => x.discovered),
    resources: w.resources,
    upgrades: w.upgrades,
    tension: w.tension,
    communications: w.communications,
    logs: w.logs,
    history: w.history,
    beams: w.beams,
    opportunities: opportunities(this),
    armory: {
      stock: { photon: this.base.stock.photon, quantum: this.base.stock.quantum },
      reserved: {
        photon: this.base.stock.photon - available(w, 'base', 'photon'),
        quantum: this.base.stock.quantum - available(w, 'base', 'quantum'),
      },
    },
  });
}
export function getObservation(this: SimulationEngine, operatorId: string): Observation | null {
  const a = this.state.assignments.find((a) => a.operatorId === operatorId),
    s = this.state.ships.find((s) => s.id === a?.shipId);
  if (!s) return null;
  const snap = this.snapshot();
  return structuredClone({
    time: snap.time,
    operatorId,
    ship: s,
    contacts: snap.contacts,
    systems: snap.systems,
    bodies: snap.bodies,
    opportunities: snap.opportunities,
    legalActions: s.current
      ? []
      : ['MOVE', 'EXPLORE', 'SURVEY', 'MINE', 'HAUL', 'PATROL', 'RETREAT'],
  });
}
