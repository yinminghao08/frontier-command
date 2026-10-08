import type { OrionState, Point, WorldState } from '../types';
import { emptyStock, makeEnemy, makeLocation } from '../data';
import { coordinateRandom, materialize } from '../world-generation';
import { BASE, SECTOR_SIZE, regionAt } from '../definitions/locations';
import { ORION_DEFENSES } from '../definitions/orion';
import { dist } from '../navigation';

export function createOrionState(): OrionState {
  return {
    intelligence: {},
    patrols: {},
    operations: [],
    jobs: [],
    logistics: [],
    servicedLoot: {},
    lootCargo: {},
    robbedTargets: {},
    provisioning: [],
    nextPlan: 0,
    realizedIncome: 0,
    ledger: [],
    shipLosses: [],
    market: {
      credits: 8000,
      stock: emptyStock(),
      capacity: { materials: 10000, photon: 600, quantum: 300, specialFinds: 100 },
    },
  };
}
export function orionLocation(w: WorldState, id: string, point: Point, headquarters: boolean) {
  const profile = headquarters ? 'orionHQ' : 'orionSupply';
  const l = makeLocation(
    id,
    headquarters ? 'Orion Syndicate Headquarters' : 'Orion Covert Supply Point',
    headquarters ? 'base' : 'outpost',
    point,
    'orion',
  );
  l.defenseProfile = profile;
  l.hull = l.maxHull = ORION_DEFENSES[profile].hull;
  l.shield = l.maxShield = ORION_DEFENSES[profile].shield;
  w.locations.push(l);
  return l;
}
function vacant(w: WorldState, preferred: Point, salt: number): Point {
  const coord = {
    q: Math.round(preferred.x / SECTOR_SIZE),
    r: Math.round(preferred.y / SECTOR_SIZE),
  };
  materialize(w, coord);
  const rng = coordinateRandom(w.initialSeed, coord, salt);
  const valid = (p: Point) =>
    regionAt(p.x, p.y) !== 'romulan' &&
    regionAt(p.x, p.y) !== 'neutral' &&
    w.locations.every((l) => dist(l, p) >= (l.owner === 'starfleet' ? 300 : 180)) &&
    w.bodies.every((b) => dist(b, p) >= 60) &&
    w.systems.every((s) => dist(s, p) >= 70) &&
    w.wormholes.every((h) => dist(h, p) >= 80);
  for (let n = 0; n < 128; n++) {
    const p = { x: preferred.x + (rng() - 0.5) * 250, y: preferred.y + (rng() - 0.5) * 250 };
    if (valid(p)) {
      materialize(w, { q: Math.round(p.x / 400), r: Math.round(p.y / 400) });
      if (valid(p)) return p;
    }
  }
  for (let r = 0; r < 10; r++)
    for (let i = 0; i < 16; i++) {
      const p = {
        x: preferred.x + Math.cos((i * Math.PI) / 8) * (200 + r * 80),
        y: preferred.y + Math.sin((i * Math.PI) / 8) * (200 + r * 80),
      };
      if (valid(p)) {
        materialize(w, { q: Math.round(p.x / 400), r: Math.round(p.y / 400) });
        if (valid(p)) return p;
      }
    }
  throw Error('Unable to place Orion facility');
}
export function seedOrion(w: WorldState) {
  const rng = coordinateRandom(w.initialSeed, { q: 0, r: 0 }, 0x0a710);
  const angle = (rng() < 0.5 ? -1 : 1) * (Math.PI * (0.28 + rng() * 0.5));
  const radius = 2000 + rng() * 450;
  let point = vacant(
    w,
    { x: BASE.x + Math.cos(angle) * radius, y: BASE.y + Math.sin(angle) * radius },
    11,
  );
  if (
    dist(point, BASE) < 1600 ||
    Math.max(Math.abs(Math.round(point.x / 400) + 1), Math.abs(Math.round(point.y / 400))) < 4
  )
    point = vacant(w, { x: BASE.x - 2000, y: -1800 }, 12);
  const hq = orionLocation(w, 'orion-base', point, true);
  hq.stock = { ...emptyStock(), materials: 120, photon: 80 };
  const count = 1 + Math.floor(rng() * 2);
  const supplies = [orionLocation(w, 'orion-supply-1', vacant(w, { x: 430, y: -580 }, 21), false)];
  if (count === 2)
    supplies.push(orionLocation(w, 'orion-supply-2', vacant(w, { x: 350, y: 660 }, 22), false));
  for (const l of supplies) l.stock = { ...emptyStock(), materials: 40, photon: 12 };
  for (let wing = 0; wing < 2; wing++) {
    const home = supplies[wing] ?? supplies[0];
    const scoutPoint = wing === 0 ? { x: 440, y: -240 } : { x: 330, y: 380 };
    const rally = wing === 0 ? { x: 410, y: -380 } : { x: 340, y: 510 };
    const scout = makeEnemy(
      wing ? 'orion-scout-2' : 'orion-scout',
      'orionScout',
      'orion',
      scoutPoint,
      home.id,
      'scout',
    );
    scout.name = 'Orion Scout ' + (wing + 1);
    w.enemies.push(scout);
    w.orion.patrols[scout.id] = {
      anchor: wing === 0 ? { x: 240, y: -80 } : { x: 120, y: 140 },
      leg: wing * 2,
    };
    for (let i = 0; i < 2; i++) {
      const s = makeEnemy(
        'orion-raider-' + (wing * 2 + i + 1),
        'orionRaider',
        'orion',
        { x: rally.x + i * 35, y: rally.y - i * 25 },
        home.id,
        'raider',
      );
      s.name = 'Orion Light Raider ' + (wing * 2 + i + 1);
      w.enemies.push(s);
      w.orion.patrols[s.id] = { anchor: scoutPoint, leg: i + wing * 3 };
    }
    const interceptor = makeEnemy(
      'orion-interceptor-' + (wing + 1),
      'orionInterceptor',
      'orion',
      rally,
      home.id,
      'interceptor',
    );
    interceptor.name = 'Orion Interceptor ' + (wing + 1);
    interceptor.modules = ['precisionTargeting'];
    w.enemies.push(interceptor);
    w.orion.patrols[interceptor.id] = { anchor: scoutPoint, leg: wing };
  }
  const heavy = makeEnemy(
    'orion-corsair',
    'orionCorsair',
    'orion',
    { x: hq.x + 70, y: hq.y },
    hq.id,
    'corsair',
  );
  heavy.name = 'Orion Heavy Corsair';
  heavy.modules = ['precisionTargeting'];
  const smuggler = makeEnemy('orion-smuggler', 'orionSmuggler', 'orion', hq, hq.id, 'smuggler');
  smuggler.name = 'Orion Smuggler Transport';
  w.enemies.push(heavy, smuggler);
  w.orion.patrols[heavy.id] = { anchor: point, leg: 0 };
  w.orion.logistics.push({
    shipId: smuggler.id,
    sourceId: hq.id,
    targetId: supplies[0].id,
    phase: 'loading',
    work: 0,
    manifest: { ...emptyStock(), materials: 30, photon: 20 },
  });
  for (const home of [hq, ...supplies])
    w.orion.ledger.push({
      id: 'orion-ledger-' + w.nextId++,
      time: w.time,
      kind: 'initialReserve',
      entityId: home.id,
      credits: home === hq ? 500 : 0,
      goods: structuredClone(home.stock),
    });
  for (const ship of w.enemies.filter((s) => s.factionId === 'orion'))
    w.orion.ledger.push({
      id: 'orion-ledger-' + w.nextId++,
      time: w.time,
      kind: 'initialShip',
      entityId: ship.id,
      credits: 0,
      goods: { ...emptyStock(), photon: ship.photon, quantum: ship.quantum },
    });
}
