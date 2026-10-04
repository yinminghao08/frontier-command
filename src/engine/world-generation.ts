import type { Body, SectorCoord, StarSystem, WorldState, Wormhole } from './types';
import { SECTOR_SIZE } from './definitions/locations';
export const sectorId = ({ q, r }: SectorCoord) => 'sector:' + q + ':' + r;
export const sectorCenter = ({ q, r }: SectorCoord) => ({ x: q * SECTOR_SIZE, y: r * SECTOR_SIZE });
export function coordinateRandom(seed: number, coord: SectorCoord, salt = 0) {
  let rng =
    (seed ^ Math.imul(coord.q, 0x45d9f3b) ^ Math.imul(coord.r, 0x27d4eb2d) ^ salt ^ 0x6a09e667) >>>
    0;
  return () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
}
export function generatedSector(seed: number, coord: SectorCoord) {
  const random = coordinateRandom(seed, coord),
    id = sectorId(coord),
    center = sectorCenter(coord),
    bodies: Body[] = [];
  const stars: StarSystem['starClass'][] = [
    'M',
    'M',
    'K',
    'K',
    'G',
    'G',
    'F',
    'A',
    'giant',
    'neutron',
  ];
  const systems: StarSystem[] = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, index) => {
    const sid = id + ':system:' + index,
      x = center.x + (random() - 0.5) * 180,
      y = center.y + (random() - 0.5) * 180;
    const children: Body[] = [];
    const add = (kind: Body['kind'], category: string, hidden = false) => {
      const b: Body = {
        id: sid + ':body:' + children.length,
        name: category + ' ' + coord.q + '/' + coord.r + '-' + index + '-' + children.length,
        systemId: sid,
        kind,
        category,
        population: 0,
        x: x + (random() - 0.5) * 120,
        y: y + (random() - 0.5) * 120,
        survey: 0,
        habitable: category === 'M-class 宜居世界',
        remaining: kind === 'resource' ? 900 + Math.floor(random() * 2200) : 0,
        richness: 0.7 + random() * 1.4,
        hazard: kind === 'anomaly' ? 0.4 + random() * 0.9 : 0.08 + random() * 0.45,
        hidden,
        specialClaimed: false,
        discovered: false,
      };
      if (b.habitable && random() < 0.25) b.population = 150 + Math.floor(random() * 500);
      children.push(b);
      return b;
    };
    const categories = ['荒芜岩石世界', '气态巨行星', '冰封世界', '火山世界', '海洋世界'];
    for (let p = 0, n = Math.floor(random() * 7); p < n; p++) {
      const planet = add(
        'planet',
        random() < 0.1 ? 'M-class 宜居世界' : categories[Math.floor(random() * categories.length)],
      );
      if (random() < 0.3) add('moon', planet.category.includes('气态') ? '冰质卫星' : '岩石卫星');
    }
    if (random() < 0.4) add('belt', '小行星带');
    if (random() < 0.32)
      add('resource', ['金属矿床', '高密度矿物带', '晶体矿床'][Math.floor(random() * 3)]);
    if (random() < 0.2)
      add('anomaly', ['亚空间剪切', '引力异常', '离子风暴'][Math.floor(random() * 3)]);
    const rare = coordinateRandom(seed, coord, 0x51ce21 ^ index);
    if (rare() < 0.035) add('anomaly', '古代空间信号', true);
    if (rare() < 0.04) add('ruins', '古代遗迹');
    if (rare() < 0.08) add('derelict', '失落研究舰');
    bodies.push(...children);
    return {
      id: sid,
      name: 'DF-' + coord.q + '/' + coord.r + '-' + String.fromCharCode(65 + index),
      sectorId: id,
      x,
      y,
      starClass: stars[Math.floor(random() * stars.length)],
      discovered: false,
      survey: 0,
      bodyIds: children.map((b) => b.id),
    };
  });
  // Symmetric coordinate pairing is independent of which endpoint is found first.
  const paired = { q: -coord.q, r: 12 - coord.r };
  const first = coord.q < paired.q || (coord.q === paired.q && coord.r < paired.r) ? coord : paired;
  const pairRandom = coordinateRandom(seed, first, 0x771234),
    wormholes: Wormhole[] = [];
  if ((coord.q !== paired.q || coord.r !== paired.r) && pairRandom() < 0.025) {
    const stability = 0.45 + pairRandom() * 0.55;
    wormholes.push({
      id: 'wormhole:' + coord.q + ':' + coord.r,
      name: '亚空间通道 ' + coord.q + '/' + coord.r,
      sectorId: id,
      x: center.x + 90,
      y: center.y - 80,
      exit: { x: paired.q * SECTOR_SIZE + 90, y: paired.r * SECTOR_SIZE - 80 },
      exitSector: paired,
      discovered: false,
      surveyed: false,
      stability,
      stable: stability >= 0.7,
      transits: 0,
    });
  }
  return {
    sector: { ...coord, id, systemIds: systems.map((s) => s.id), discovered: false },
    systems,
    bodies,
    wormholes,
  };
}
export function materialize(w: WorldState, coord: SectorCoord) {
  const existing = w.sectors.find((s) => s.id === sectorId(coord));
  if (existing) return existing;
  const generated = generatedSector(w.initialSeed, coord);
  w.sectors.push(generated.sector);
  w.systems.push(...generated.systems);
  w.bodies.push(...generated.bodies);
  w.wormholes.push(...generated.wormholes);
  for (const b of generated.bodies.filter((b) => b.kind === 'derelict'))
    w.wrecks.push({
      id: 'wreck:' + b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      stock: { materials: 40, supplies: 12, photon: 0, quantum: 0, specialFinds: 0 },
      discovered: false,
    });
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
