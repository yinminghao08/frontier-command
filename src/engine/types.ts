import type { SimulationSpeed } from './clock';
import type { ShipClassId } from './definitions/ships';
export type Point = { x: number; y: number };
export type FactionId = 'starfleet' | 'orion' | 'romulan';
export const GOODS = ['materials', 'supplies', 'photon', 'quantum', 'specialFinds'] as const;
export type CargoKind = (typeof GOODS)[number];
export type Stock = Record<CargoKind, number>;
export type Ammunition = { photon: number; quantum: number };
export type ROE = 'HOLD FIRE' | 'RETURN FIRE' | 'ENGAGE HOSTILES';
export type ModuleId =
  | 'deepScan'
  | 'longRangeSensors'
  | 'precisionTargeting'
  | 'reinforcedShields'
  | 'expandedCargo';
export type UpgradeId = 'shipyard' | 'armory' | 'sensors' | 'logistics' | 'defense';
export type FacilityKind = 'base' | 'colony' | 'mine' | 'outpost' | 'platform';
export type RouteKind = 'safe' | 'direct' | 'risky';
export type SectorCoord = { q: number; r: number };
export interface Sector extends SectorCoord {
  id: string;
  systemIds: string[];
  discovered: boolean;
}
export interface StarSystem extends Point {
  id: string;
  name: string;
  sectorId: string;
  discovered: boolean;
  survey: number;
  bodyIds: string[];
}
export interface Body extends Point {
  id: string;
  name: string;
  systemId: string;
  kind: 'planet' | 'resource' | 'anomaly';
  survey: number;
  habitable: boolean;
  remaining: number;
  richness: number;
  hazard: number;
  hidden: boolean;
  specialClaimed: boolean;
  discovered: boolean;
}
export interface Location extends Point {
  id: string;
  name: string;
  label: string;
  kind: FacilityKind;
  owner: FactionId;
  siteId: string | null;
  stock: Stock;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  core: number;
  attackedAt: number;
  cooldown: number;
  distress: boolean;
  discovered: boolean;
  production: number;
}
export type Action =
  | { type: 'MOVE'; point: Point }
  | { type: 'EXPLORE'; sector: SectorCoord; approach: 'remote' | 'close' }
  | { type: 'SURVEY'; targetId: string; approach: 'remote' | 'close'; deep: boolean }
  | { type: 'MINE'; targetId: string; unloadId: string; repeat: boolean }
  | {
      type: 'HAUL';
      sourceId: string;
      targetId: string;
      cargoKind: CargoKind;
      amount: number;
      route: RouteKind;
      repeat: boolean;
    }
  | {
      type: 'ATTACK' | 'DISABLE' | 'DRIVE_OFF' | 'INTERCEPT' | 'SHADOW';
      targetId: string;
      subsystem?: 'engines' | 'weapons';
    }
  | { type: 'ESCORT'; targetId: string }
  | { type: 'PATROL'; targetId: string; duration: number }
  | { type: 'RETREAT' | 'DOCK'; targetId: string }
  | { type: 'REPAIR'; targetId: string }
  | { type: 'REARM'; targetId: string; load: Ammunition }
  | { type: 'REFIT'; targetId: string; moduleId: ModuleId; remove: boolean }
  | { type: 'UNLOAD'; targetId: string }
  | { type: 'RECOVER'; targetId: string };
export interface Directive {
  id: string;
  action: Action;
  created: number;
  phase: string;
  work: number;
  moved: number;
  carried: number;
  delivered: number;
  reserved: Stock;
  paidCredits: number;
  search: number;
  note: string;
}
export interface Ship extends Point {
  id: string;
  name: string;
  classId: ShipClassId;
  factionId: FactionId;
  hull: number;
  shield: number;
  core: number;
  photon: number;
  quantum: number;
  modules: ModuleId[];
  engines: number;
  weapons: number;
  status: 'docked' | 'active' | 'idle';
  current: Directive | null;
  queue: Directive[];
  suspended: Directive[];
  standing: { roe: ROE; retreatHull: number };
  path: Point[];
  heading: number;
  cargo: Stock;
  cooldowns: Record<string, number>;
  lastAttackerId: string | null;
  attackedAt: number;
  scanUntil: number;
  cloak: 'off' | 'on' | 'decloaking';
  cloakUntil: number;
}
export interface Enemy extends Ship {
  homeId: string;
  role: 'scout' | 'raider' | 'warbird';
  intent: 'observe' | 'raid' | 'probe' | 'patrol' | 'retreat' | 'docked';
  targetId: string | null;
  destination: Point | null;
  nextDecision: number;
  visited: string[];
  loot: number;
}
export type IntelLevel = 'CONTACT' | 'CLASSIFIED' | 'IDENTIFIED' | 'TRACKED';
export interface IntelRecord extends Point {
  id: string;
  level: IntelLevel;
  strength: number;
  lastSeen: number;
  live: boolean;
  hostile: boolean;
  name?: string;
  factionId?: FactionId;
  classId?: ShipClassId;
  hull?: number;
  shield?: number;
  velocity: Point;
  resolved: boolean;
  lastAttackTargetId?: string;
  lastAttackAt?: number;
}
export interface ThreatReport extends Point {
  id: string;
  observerId: string;
  seenAt: number;
  value: number;
  defense: number;
  kind: 'ship' | 'facility';
}
export interface FactionState {
  reports: ThreatReport[];
  credits: number;
  production: number;
  losses: string[];
  stance: 'observe' | 'probe' | 'patrol' | 'escalate';
}
export interface Cost {
  credits: number;
  materials: number;
  supplies: number;
  specialFinds: number;
}
export interface Construction extends Point {
  id: string;
  name: string;
  kind: Exclude<FacilityKind, 'base'>;
  siteId: string;
  stock: Stock;
  cost: Cost;
  work: number;
  duration: number;
  complete: boolean;
}
export interface IndustryJob {
  id: string;
  kind: 'ship' | 'upgrade' | 'manufacture';
  key: string;
  amount: number;
  work: number;
  duration: number;
  complete: boolean;
  name: string;
}
export interface Operator {
  id: string;
  name: string;
  kind: 'rules';
  availability: 'available' | 'vesselLost';
}
export interface Assignment {
  operatorId: string;
  shipId: string;
  since: number;
}
export interface LossRecord {
  shipId: string;
  name: string;
  classId: ShipClassId;
  tick: number;
  position: Point;
  reason: string;
  cargo: Stock;
  ammunition: Ammunition;
  operatorIds: string[];
}
export interface HistoryEntry {
  id: number;
  time: number;
  kind: string;
  text: string;
  entityId: string | null;
}
export interface Communication {
  id: number;
  time: number;
  priority: 'normal' | 'high' | 'urgent';
  text: string;
  read: boolean;
  entityId: string | null;
  category: 'request' | 'report' | 'threat' | 'decision';
}
export interface LogEntry {
  id: number;
  time: number;
  level: 'info' | 'success' | 'warning' | 'danger';
  text: string;
}
export interface Beam {
  from: Point;
  to: Point;
  enemy: boolean;
  weapon: string;
  expires: number;
}
export const CRITICAL_KINDS = [
  'lowHull',
  'shipDestroyed',
  'facilityDestroyed',
  'escalation',
  'commandLost',
] as const;
export interface CriticalReason {
  kind: (typeof CRITICAL_KINDS)[number];
  entityId: string;
  tick: number;
  time: number;
  message: string;
}
export type SimulationEvent =
  | { type: 'dayBoundary'; day: number; tick: number; time: number }
  | { type: 'criticalPause'; reasons: CriticalReason[] }
  | { type: 'shipDestroyed'; shipId: string; operatorIds: string[]; tick: number }
  | { type: 'commandLost'; tick: number };
export interface Wreck extends Point {
  id: string;
  name: string;
  stock: Stock;
  discovered: boolean;
}
export interface WorldState {
  version: 6;
  tick: number;
  time: number;
  seed: number;
  initialSeed: number;
  paused: boolean;
  speed: SimulationSpeed;
  status: 'active' | 'commandLost';
  pauseReasons: CriticalReason[];
  commander: { id: string; name: string; rank: string };
  operators: Operator[];
  assignments: Assignment[];
  losses: LossRecord[];
  ships: Ship[];
  enemies: Enemy[];
  sectors: Sector[];
  systems: StarSystem[];
  bodies: Body[];
  locations: Location[];
  projects: Construction[];
  jobs: IndustryJob[];
  wrecks: Wreck[];
  intel: IntelRecord[];
  factions: { orion: FactionState; romulan: FactionState };
  tension: number;
  resources: { credits: number };
  upgrades: Record<UpgradeId, number>;
  rearProduction: number;
  communications: Communication[];
  logs: LogEntry[];
  history: HistoryEntry[];
  beams: Beam[];
  nextId: number;
  nextLog: number;
  nextComms: number;
  nextHistory: number;
}
export interface Opportunity {
  id: string;
  kind: 'exploration' | 'mining' | 'logistics' | 'security' | 'construction';
  targetId: string;
  text: string;
}
/** Public read model: faction assets, intentions, seed and unknown geography are deliberately absent. */
interface SnapshotData {
  version: 6;
  tick: number;
  time: number;
  paused: boolean;
  speed: SimulationSpeed;
  status: WorldState['status'];
  pauseReasons: CriticalReason[];
  commander: WorldState['commander'];
  operators: Operator[];
  assignments: Assignment[];
  losses: LossRecord[];
  ships: Ship[];
  contacts: IntelRecord[];
  sectors: Sector[];
  systems: StarSystem[];
  bodies: Body[];
  locations: Location[];
  projects: Construction[];
  jobs: IndustryJob[];
  wrecks: Wreck[];
  resources: WorldState['resources'];
  upgrades: WorldState['upgrades'];
  tension: number;
  communications: Communication[];
  logs: LogEntry[];
  history: HistoryEntry[];
  beams: Beam[];
  opportunities: Opportunity[];
  armory: { stock: Ammunition; reserved: Ammunition };
}
export type Command =
  | {
      type: 'issueDirective';
      shipIds: string[];
      mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
      action: Action;
    }
  | { type: 'cancelDirective'; shipId: string }
  | { type: 'standingOrders'; shipId: string; roe: ROE; retreatHull: number }
  | { type: 'renameEntity'; entityId: string; name: string }
  | { type: 'startConstruction'; siteId: string; kind: Exclude<FacilityKind, 'base'>; name: string }
  | { type: 'buildShip'; classId: ShipClassId; name: string }
  | { type: 'upgrade'; upgradeId: UpgradeId }
  | { type: 'manufacture'; cargoKind: 'supplies' | 'photon' | 'quantum'; amount: number }
  | { type: 'sellStock'; cargoKind: CargoKind; amount: number }
  | { type: 'repairFacility'; locationId: string }
  | { type: 'acknowledge'; communicationId: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: SimulationSpeed };
export type SessionCommand = { type: 'restorePreviousDay' | 'beginNewFrontier' };
export type CommandResult = { ok: boolean; reason: string };
interface ObservationData {
  time: number;
  operatorId: string;
  ship: Ship;
  contacts: IntelRecord[];
  systems: StarSystem[];
  bodies: Body[];
  opportunities: Opportunity[];
  legalActions: string[];
}
export interface AgentControllerPort {
  getObservation(): Observation | null;
  submitAction(action: Action): CommandResult;
}

/** Renderer and decision-layer observations cannot be mutated by consumers. */
export type ReadonlyDeep<T> = T extends readonly (infer Item)[]
  ? readonly ReadonlyDeep<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
    : T;
export type Snapshot = ReadonlyDeep<SnapshotData>;
export type Observation = ReadonlyDeep<ObservationData>;
