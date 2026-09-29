import type { SimulationSpeed } from './clock';
import type { ShipClassId } from './definitions/ships';
export type Point = { x: number; y: number };
export type FactionId = 'starfleet' | 'pirate' | 'romulan';
export type CargoKind = 'supplies' | 'medical' | 'materials';
export type Stock = Record<CargoKind, number>;
export interface GeographicLocation extends Point {
  id: string;
  name: string;
  label: string;
  kind: 'base' | 'colony' | 'outpost' | 'anomaly' | 'border' | 'mine' | 'planet';
  regionId: 'federation' | 'neutral' | 'romulan';
  supply: number;
}
export interface Location extends GeographicLocation {
  stock: Stock;
  reserved: Stock;
  hull: number;
  maxHull: number;
  distress: boolean;
  surveyed: boolean;
  hazard: number;
  surveyRevision: number;
  rewardedRevision: number;
}
export type ROE = 'HOLD FIRE' | 'RETURN FIRE' | 'ENGAGE HOSTILES' | 'WEAPONS FREE';
export type BorderPolicy = 'federation' | 'neutral' | 'romulan';
export type Priority = 'normal' | 'high' | 'urgent';
export type OrderKind = 'defense' | 'transport' | 'explore';
export type Objective =
  | { type: 'location' | 'ship' | 'contact'; id: string }
  | { type: 'point'; x: number; y: number; id?: never };
export interface OrderSpec {
  kind: OrderKind;
  objective: Objective;
  shipIds: string[];
  priority: Priority;
  roe: ROE;
  border: BorderPolicy;
  retreat: { hull: number; shield: number; core: number; emptyAmmo: boolean };
  duration: number;
  sourceId: string;
  cargoKind: CargoKind;
  amount: number;
  route: 'safe' | 'fast';
  approach: 'remote' | 'close';
}
export type OrderPhase =
  | 'preparing'
  | 'outbound'
  | 'decision'
  | 'working'
  | 'returning'
  | 'complete';
export interface OperationOrder extends OrderSpec {
  id: string;
  created: number;
  phase: OrderPhase;
  work: number;
  decisionAt: number;
  settled: boolean;
  outcome: 'success' | 'failed' | 'cancelled' | null;
  result: string;
  held: boolean;
  loaded: boolean;
  delivered: boolean;
  reserved: number;
  deadline: number;
  targetLastSeen: Point | null;
  searchUntil: number;
  rewarded: boolean;
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
  status: 'docked' | 'mission' | 'returning' | 'disabled' | 'repairing' | 'rearming';
  orderId: string | null;
  targetId: string | null;
  path: Point[];
  heading: number;
  cargo: Stock;
  cooldowns: Record<string, number>;
  service: number;
  lastAttackerId: string | null;
  attackedAt: number;
  scanUntil: number;
  cloak: 'off' | 'on' | 'decloaking';
  cloakUntil: number;
  behavior: 'hold' | 'defend' | 'engage' | 'retreat' | 'scan' | 'travel';
}
export interface Enemy extends Ship {
  home: Point;
  intent: 'observe' | 'raid' | 'probe' | 'retreat';
  nextDecision: number;
  loot: number;
  knownTargets: { id: string; x: number; y: number; seenAt: number; score: number }[];
}
export type IntelLevel = 'UNKNOWN' | 'CONTACT' | 'CLASSIFIED' | 'IDENTIFIED' | 'TRACKED';
export interface IntelRecord extends Point {
  id: string;
  level: IntelLevel;
  strength: number;
  lastSeen: number;
  live: boolean;
  name?: string;
  factionId?: FactionId;
  classId?: ShipClassId;
  hostile: boolean;
  hull?: number;
  shield?: number;
  lastAttackTargetId?: string;
  lastAttackAt?: number;
  resolved: boolean;
  resolution?: 'destroyed' | 'withdrawn';
}
export interface Communication {
  id: number;
  time: number;
  priority: Priority;
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
  'investigation',
  'contactDetected',
  'hostility',
  'lowHull',
  'disabled',
  'missionFailed',
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
  | { type: 'criticalPause'; reasons: CriticalReason[] };
export interface Operator {
  id: string;
  shipId: string;
  kind: 'rules';
  name: string;
}
export interface WorldState {
  version: 4;
  tick: number;
  time: number;
  seed: number;
  initialSeed: number;
  paused: boolean;
  pauseReasons: CriticalReason[];
  speed: SimulationSpeed;
  commander: { id: string; name: string; rank: string };
  operators: Operator[];
  ships: Ship[];
  enemies: Enemy[];
  intel: IntelRecord[];
  orders: OperationOrder[];
  locations: Location[];
  resources: { science: number; intel: number; allocation: number };
  communications: Communication[];
  logs: LogEntry[];
  beams: Beam[];
  nextLog: number;
  nextComms: number;
  nextOrder: number;
  nextEnemy: number;
  nextIncursion: number;
  explored: { x: number; y: number; time: number }[];
}
/** Deliberate projection: never expose enemy entities or their AI goals. */
export interface Snapshot {
  version: 4;
  tick: number;
  time: number;
  paused: boolean;
  speed: SimulationSpeed;
  pauseReasons: CriticalReason[];
  commander: WorldState['commander'];
  operators: Operator[];
  ships: Ship[];
  contacts: IntelRecord[];
  orders: OperationOrder[];
  locations: Location[];
  resources: WorldState['resources'];
  communications: Communication[];
  logs: LogEntry[];
  beams: Beam[];
  explored: WorldState['explored'];
}
export type Command =
  | { type: 'createOrder'; spec: OrderSpec }
  | {
      type: 'updateOrder';
      orderId: string;
      changes: Partial<
        Pick<
          OrderSpec,
          'priority' | 'roe' | 'retreat' | 'border' | 'route' | 'approach' | 'objective' | 'shipIds'
        >
      >;
    }
  | { type: 'cancelOrder' | 'holdOrder' | 'resumeOrder'; orderId: string }
  | { type: 'investigate'; orderId: string; approach: 'remote' | 'close' }
  | { type: 'scan' | 'recall' | 'repair' | 'rearm'; shipId: string }
  | { type: 'acknowledge'; communicationId: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: SimulationSpeed };
export type CommandResult = { ok: boolean; reason: string };
export interface Observation {
  time: number;
  operatorId: string;
  ship: Ship;
  contacts: IntelRecord[];
  orders: OperationOrder[];
  legalActions: string[];
}
export interface AgentControllerPort {
  getObservation(): Observation | null;
  dispatchCommand(command: Command): CommandResult;
}
