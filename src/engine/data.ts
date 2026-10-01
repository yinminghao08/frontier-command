import type { Enemy, FactionId, Point, Ship, Stock, WorldState, OrderSpec } from './types';
import { BASE, LOCATIONS } from './definitions/locations';
import { INITIAL_FLEET, SHIP_CLASSES, type ShipClassId } from './definitions/ships';
import { RULES } from './definitions/rules';
import { RESOURCE_DEFINITIONS } from './definitions/resources';
export { BASE, LOCATIONS, WORLD_WIDTH, WORLD_HEIGHT } from './definitions/locations';
export const emptyStock = (): Stock => ({ supplies: 0, medical: 0, materials: 0 });
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
    status: factionId === 'starfleet' ? 'docked' : 'mission',
    orderId: null,
    targetId: null,
    path: [],
    heading: 0,
    cargo: emptyStock(),
    cooldowns: {},
    service: 0,
    rearm: { photon: 0, quantum: 0 },
    lastAttackerId: null,
    attackedAt: -1000,
    scanUntil: 0,
    cloak: d.cloak ? 'on' : 'off',
    cloakUntil: 0,
    behavior: 'hold',
  };
}
export function makeEnemy(
  id: string,
  classId: ShipClassId,
  factionId: 'pirate' | 'romulan',
  p: Point,
): Enemy {
  return {
    ...makeShip(id, SHIP_CLASSES[classId].name, classId, factionId, p),
    home: { x: p.x, y: p.y },
    destination: null,
    departed: false,
    visited: [],
    intent: factionId === 'pirate' ? 'raid' : 'observe',
    nextDecision: 0,
    loot: 0,
    knownTargets: [],
  };
}
export function defaultOrder(kind: OrderSpec['kind'] = 'defense'): OrderSpec {
  return {
    kind,
    objective: { type: 'location', id: kind === 'explore' ? 'anomaly1' : 'colony' },
    shipIds: [],
    priority: 'normal',
    roe: kind === 'defense' ? 'ENGAGE HOSTILES' : 'RETURN FIRE',
    border: 'federation',
    retreat: { hull: 30, shield: 0, core: 0, emptyAmmo: false },
    duration: RULES.defenseMinutes,
    sourceId: 'base',
    cargoKind: 'supplies',
    amount: 30,
    route: 'safe',
    approach: 'remote',
  };
}
export function createWorld(seed = 236807): WorldState {
  const ships = INITIAL_FLEET.map((s, i) =>
    makeShip(s.id, s.name, s.classId, 'starfleet', { x: BASE.x + (i - 1.5) * 70, y: BASE.y + 90 }),
  );
  return {
    version: 5,
    status: 'active',
    losses: [],
    assignments: ships.map((s) => ({ operatorId: 'ops-' + s.id, shipId: s.id, since: 0 })),
    armory: { stock: { photon: 120, quantum: 36 }, reserved: { photon: 0, quantum: 0 } },
    romulanReports: [],
    tick: 0,
    time: 0,
    seed: seed >>> 0,
    initialSeed: seed >>> 0,
    paused: true,
    pauseReasons: [],
    speed: 1,
    commander: { id: 'commander', name: '边疆舰队总指挥', rank: 'ADMIRAL' },
    operators: ships.map((s) => ({
      id: 'ops-' + s.id,
      availability: 'available',
      kind: 'rules',
      name: SHIP_CLASSES[s.classId].name + ' 值班指挥组',
    })),
    ships,
    enemies: [
      makeEnemy('enemy-1', 'raider', 'pirate', RULES.pirateEntry),
      makeEnemy('enemy-2', 'scout', 'romulan', RULES.romulanEntry),
      makeEnemy('enemy-3', 'valdore', 'romulan', { x: 1530, y: 450 }),
      makeEnemy('enemy-4', 'dderidex', 'romulan', { x: 1510, y: 680 }),
    ],
    intel: [],
    orders: [],
    locations: LOCATIONS.map((l) => ({
      ...l,
      stock: {
        supplies: l.kind === 'base' ? RESOURCE_DEFINITIONS.supplies.initial : l.supply,
        medical: l.kind === 'base' ? RESOURCE_DEFINITIONS.medical.initial : 15,
        materials: l.kind === 'base' ? RESOURCE_DEFINITIONS.materials.initial : 20,
      },
      reserved: emptyStock(),
      hull: l.kind === 'base' ? RULES.baseHull : 200,
      maxHull: l.kind === 'base' ? RULES.baseHull : 200,
      shield: l.kind === 'base' ? RULES.baseShield : 0,
      maxShield: l.kind === 'base' ? RULES.baseShield : 0,
      attackedAt: -1000,
      distress: l.id === 'colony',
      surveyed: false,
      hazard: l.kind === 'anomaly' ? 1 : 0,
      surveyRevision: 1,
      rewardedRevision: 0,
    })),
    resources: { science: 0, intel: 0, allocation: 0 },
    communications: [
      {
        id: 1,
        time: 0,
        priority: 'high',
        text: '新曙殖民地请求补给与航道防卫。可分别派运输舰与防御舰。',
        read: false,
        entityId: 'colony',
        category: 'request',
      },
      {
        id: 2,
        time: 0,
        priority: 'normal',
        text: '琥珀星云等待调查：远距扫描或近距采样，请指挥官决定。',
        read: false,
        entityId: 'anomaly1',
        category: 'request',
      },
    ],
    logs: [],
    beams: [],
    nextLog: 1,
    nextComms: 3,
    nextOrder: 1,
    nextEnemy: 5,
    nextIncursion: RULES.incursionMinutes,
    explored: [],
  };
}
