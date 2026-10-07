import type { SimulationEngine } from './engine';
import type { Ship, Wormhole } from './types';
import { materialize } from './world-generation';

/** Shared physical transit for explicit TRANSIT and planned journeys. */
export function transit(e: SimulationEngine, s: Ship, h: Wormhole) {
  const w = e.state;
  h.surveyed = true;
  h.transits++;
  if (!h.stable) {
    e.hit(s, 20 * (1 - h.stability));
    h.stability = Math.max(0.1, h.stability - 0.03);
  }
  if (s.hull <= 0) return false;
  s.x = h.exit.x;
  s.y = h.exit.y;
  s.path = [];
  const sector = materialize(w, h.exitSector);
  sector.discovered = true;
  if (
    !w.wormholes.some(
      (other) => other.sectorId === sector.id && other.x === h.exit.x && other.y === h.exit.y,
    )
  )
    w.wormholes.push({
      ...h,
      id: 'wormhole:' + h.exitSector.q + ':' + h.exitSector.r,
      sectorId: sector.id,
      x: h.exit.x,
      y: h.exit.y,
      name: '亚空间通道 ' + h.exitSector.q + '/' + h.exitSector.r,
      exit: { x: h.x, y: h.y },
      exitSector: { q: Math.floor((h.x + 200) / 400), r: Math.floor((h.y + 200) / 400) },
      transits: 0,
    });
  for (const sys of w.systems.filter((sys) => sys.sectorId === sector.id)) {
    const fresh = !sys.discovered;
    sys.discovered = true;
    sys.survey = Math.max(sys.survey, 1);
    for (const b of w.bodies.filter((b) => b.systemId === sys.id && !b.hidden)) {
      b.discovered = true;
      b.survey = Math.max(b.survey, 1);
    }
    if (fresh) e.record('discovery', s.name + ' 发现 ' + sys.name + '，永久星图已更新', sys.id);
  }
  for (const other of w.wormholes.filter((x) => x.sectorId === sector.id)) {
    other.discovered = true;
    if (other.x === h.exit.x && other.y === h.exit.y) {
      other.surveyed = true;
      other.stability = h.stability;
      other.stable = h.stable;
    }
  }
  e.pendingEvents.push({
    type: 'shipTransited',
    shipId: s.id,
    destination: { x: s.x, y: s.y },
    tick: w.tick,
  });
  e.record('wormhole', s.name + '实际穿越 ' + h.name + '，航线与星图改变', h.id);
  return true;
}
