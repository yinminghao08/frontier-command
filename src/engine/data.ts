import type {
  Enemy,
  FacilityKind,
  FactionId,
  Location,
  Point,
  Ship,
  Stock,
  WorldState,
} from './types';
import { BASE, INITIAL_LOCATIONS } from './definitions/locations';
import { INITIAL_FLEET, SHIP_CLASSES, type ShipClassId } from './definitions/ships';
import { FACILITIES } from './definitions/progression';
import { materialize } from './world-generation';
export { BASE } from './definitions/locations';
export const emptyStock = (): Stock => ({
  materials: 0,
  supplies: 0,
  photon: 0,
  quantum: 0,
  specialFinds: 0,
});
export function makeShip(
  id: string,
  name: string,
  classId: ShipClassId,
  factionId: FactionId,
  p: Point,
): Ship {
  const d = SHIP_CLASSES[classId];
  return {
    id,
    name,
    classId,
    factionId,
    x: p.x,
    y: p.y,
    hull: d.hull,
    shield: d.shield,
    core: d.core,
    photon: d.photon,
    quantum: d.quantum,
    modules: [],
    engines: 100,
    weapons: 100,
    status: factionId === 'starfleet' ? 'docked' : 'active',
    current: null,
    queue: [],
    suspended: [],
    standing: { roe: 'RETURN FIRE', retreatHull: 30 },
    path: [],
    heading: 0,
    cargo: emptyStock(),
    cooldowns: {},
    lastAttackerId: null,
    attackedAt: -1000,
    scanUntil: 0,
    cloak: d.cloak ? 'on' : 'off',
    cloakUntil: 0,
  };
}
export function makeEnemy(
  id: string,
  classId: ShipClassId,
  factionId: 'orion' | 'romulan',
  p: Point,
  homeId = factionId + '-base',
  role: Enemy['role'] = 'raider',
): Enemy {
  return {
    ...makeShip(
      id,
      factionId === 'orion'
        ? 'Orion ' + (role === 'scout' ? 'Surveyor' : 'Raider') + ' ' + id
        : SHIP_CLASSES[classId].name,
      classId,
      factionId,
      p,
    ),
    homeId,
    role,
    intent: 'observe',
    targetId: null,
    destination: null,
    nextDecision: 0,
    visited: [],
    loot: 0,
  };
}
export function makeLocation(
  id: string,
  name: string,
  kind: FacilityKind,
  p: Point,
  owner: FactionId = 'starfleet',
  siteId: string | null = null,
): Location {
  const def = FACILITIES[kind];
  return {
    id,
    name,
    label: name,
    kind,
    owner,
    siteId,
    x: p.x,
    y: p.y,
    stock: emptyStock(),
    hull: def.hull,
    maxHull: def.hull,
    shield: def.shield,
    maxShield: def.shield,
    core: 300,
    attackedAt: -1000,
    cooldown: 0,
    distress: false,
    discovered: owner === 'starfleet',
    production: 0,
  };
}
export function createWorld(seed = 236807): WorldState {
  const ships = INITIAL_FLEET.map((s, i) =>
    makeShip(s.id, s.name, s.classId, 'starfleet', { x: BASE.x + (i - 1.5) * 28, y: BASE.y + 45 }),
  );
  const w: WorldState = {
    version: 6,
    tick: 0,
    time: 0,
    seed: seed >>> 0,
    initialSeed: seed >>> 0,
    paused: true,
    speed: 1,
    status: 'active',
    pauseReasons: [],
    commander: { id: 'commander', name: 'Dawn Frontier Command', rank: 'ADMIRAL' },
    operators: ships.map((s) => ({
      id: 'ops-' + s.id,
      name: s.name + ' · 值班指挥组',
      kind: 'rules',
      availability: 'available',
    })),
    assignments: ships.map((s) => ({ operatorId: 'ops-' + s.id, shipId: s.id, since: 0 })),
    losses: [],
    ships,
    enemies: [],
    sectors: [],
    systems: [],
    bodies: [],
    locations: INITIAL_LOCATIONS.map((l) => makeLocation(l.id, l.name, l.kind, l)),
    projects: [],
    jobs: [],
    wrecks: [],
    intel: [],
    factions: {
      orion: { reports: [], credits: 40, production: 0, losses: [], stance: 'observe' },
      romulan: { reports: [], credits: 150, production: 0, losses: [], stance: 'observe' },
    },
    tension: 0,
    resources: { credits: 380 },
    upgrades: { shipyard: 0, armory: 0, sensors: 0, logistics: 0, defense: 0 },
    rearProduction: 0,
    communications: [],
    logs: [],
    history: [],
    beams: [],
    nextId: 1,
    nextLog: 1,
    nextComms: 1,
    nextHistory: 1,
  };
  const base = w.locations[0];
  base.stock = { materials: 70, supplies: 120, photon: 90, quantum: 20, specialFinds: 0 };
  w.locations.find((l) => l.id === 'colony')!.stock.supplies = 12;
  w.locations.find((l) => l.id === 'mine')!.stock = {
    ...emptyStock(),
    materials: 25,
    supplies: 20,
  };
  w.locations.find((l) => l.id === 'outpost')!.stock.supplies = 20;
  for (const coord of [
    { q: -1, r: 0 },
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]) {
    const sec = materialize(w, coord);
    sec.discovered = true;
    for (const sys of w.systems.filter((s) => s.sectorId === sec.id)) {
      sys.discovered = true;
      sys.survey = 1;
      for (const b of w.bodies.filter((b) => b.systemId === sys.id)) {
        b.discovered = !b.hidden;
        b.survey = b.hidden ? 0 : 1;
      }
    }
  }
  const initialMine = w.bodies.find(
    (b) =>
      b.kind === 'resource' &&
      w.systems.find((s) => s.id === b.systemId)?.sectorId === 'sector:1:0',
  )!;
  initialMine.x = 240;
  initialMine.y = -80;
  initialMine.survey = 2;
  w.locations.find((l) => l.id === 'mine')!.siteId = initialMine.id;
  const initialPlanet = w.bodies.find(
    (b) =>
      b.kind === 'planet' && w.systems.find((s) => s.id === b.systemId)?.sectorId === 'sector:0:0',
  )!;
  initialPlanet.x = 130;
  initialPlanet.y = 140;
  initialPlanet.survey = 2;
  w.locations.find((l) => l.id === 'colony')!.siteId = initialPlanet.id;
  const orion = makeLocation(
    'orion-base',
    'Orion Hideout',
    'outpost',
    { x: 500, y: -530 },
    'orion',
  );
  orion.stock = { ...emptyStock(), materials: 15, supplies: 30, photon: 12 };
  w.locations.push(orion);
  const romulan = makeLocation(
    'romulan-base',
    'Romulan Border Command',
    'base',
    { x: 1180, y: 150 },
    'romulan',
  );
  romulan.stock = { ...emptyStock(), materials: 40, supplies: 100, photon: 60 };
  w.locations.push(romulan);
  w.enemies = [
    makeEnemy('orion-scout', 'raider', 'orion', { x: 400, y: -250 }, orion.id, 'scout'),
    makeEnemy('orion-raider-1', 'raider', 'orion', { x: 500, y: -480 }, orion.id),
    makeEnemy('orion-raider-2', 'raider', 'orion', { x: 540, y: -510 }, orion.id),
    makeEnemy('romulan-scout', 'scout', 'romulan', { x: 820, y: 50 }, romulan.id, 'scout'),
    makeEnemy('romulan-warbird', 'valdore', 'romulan', { x: 1060, y: 180 }, romulan.id, 'warbird'),
  ];
  w.communications.push({
    id: w.nextComms++,
    time: 0,
    priority: 'high',
    text: 'ADMIRAL：四舰待命。向 UNKNOWN SPACE 测绘，矿场已有材料等待运回；新曙殖民地需要补给。',
    read: false,
    entityId: 'mine',
    category: 'request',
  });
  return w;
}
