import type { Body, SectorCoord, WorldState } from './types';
import { SECTOR_SIZE } from './definitions/locations';
export const sectorId = ({ q, r }: SectorCoord) => 'sector:' + q + ':' + r;
export const sectorCenter = ({ q, r }: SectorCoord) => ({ x: q * SECTOR_SIZE, y: r * SECTOR_SIZE });
export function generatedSector(seed: number, coord: SectorCoord) {
  let rng =
    (seed ^ Math.imul(coord.q, 0x45d9f3b) ^ Math.imul(coord.r, 0x27d4eb2d) ^ 0x6a09e667) >>> 0;
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const id = sectorId(coord),
    center = sectorCenter(coord),
    bodies: Body[] = [];
  const systems = Array.from({ length: 1 + Number(random() > 0.65) }, (_, index) => {
    const sid = id + ':system:' + index,
      x = center.x + (random() - 0.5) * 130,
      y = center.y + (random() - 0.5) * 130;
    const add = (kind: Body['kind'], offset: number, hidden = false): Body => ({
      id: sid + ':' + kind + ':' + offset,
      name:
        { planet: '未命名 M-class', resource: '矿物带', anomaly: '亚空间异常' }[kind] +
        ' ' +
        coord.q +
        '/' +
        coord.r +
        '-' +
        index,
      systemId: sid,
      kind,
      x: x + (random() - 0.5) * 90,
      y: y + (random() - 0.5) * 90,
      survey: 0,
      habitable: kind === 'planet' && (index === 0 || random() > 0.4),
      remaining: kind === 'resource' ? 600 + Math.floor(random() * 1000) : 0,
      richness: 0.7 + random() * 1.4,
      hazard: kind === 'anomaly' ? 0.8 + random() : 0.12 + random() * 0.4,
      hidden,
      specialClaimed: false,
      discovered: false,
    });
    const children = [
      add('planet', 0),
      add('resource', 0),
      add('anomaly', 0),
      add('anomaly', 1, true),
    ];
    if (random() > 0.5) children.push(add('planet', 1));
    bodies.push(...children);
    return {
      id: sid,
      name: 'DF-' + coord.q + '/' + coord.r + '-' + String.fromCharCode(65 + index),
      sectorId: id,
      x,
      y,
      discovered: false,
      survey: 0,
      bodyIds: children.map((b) => b.id),
    };
  });
  return {
    sector: { ...coord, id, systemIds: systems.map((s) => s.id), discovered: false },
    systems,
    bodies,
  };
}
export function materialize(w: WorldState, coord: SectorCoord) {
  const existing = w.sectors.find((s) => s.id === sectorId(coord));
  if (existing) return existing;
  const generated = generatedSector(w.initialSeed, coord);
  w.sectors.push(generated.sector);
  w.systems.push(...generated.systems);
  w.bodies.push(...generated.bodies);
  return generated.sector;
}
export function frontierSectors(
  sectors: readonly { q: number; r: number; discovered: boolean }[],
): SectorCoord[] {
  const known = new Set(sectors.filter((s) => s.discovered).map(sectorId));
  const result = new Map<string, SectorCoord>();
  for (const s of sectors.filter((s) => s.discovered))
    for (const [dq, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, -1],
      [-1, 1],
    ]) {
      const c = { q: s.q + dq, r: s.r + dr };
      if (!known.has(sectorId(c))) result.set(sectorId(c), c);
    }
  return [...result.values()].sort((a, b) => a.q - b.q || a.r - b.r);
}
