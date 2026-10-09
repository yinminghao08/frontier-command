import type { SimulationSpeed } from './clock';
import type { ShipClassId } from './definitions/ships';
import type { ObjectiveGoal, RuntimeState } from './agent-runtime/model';
export type Point = { x: number; y: number };
export type FactionId = 'starfleet' | 'orion' | 'romulan';
export const GOODS = ['materials', 'photon', 'quantum', 'specialFinds'] as const;
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
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';
export type AgentCareer = 'battle' | 'logistics';
export type Activity = 'security' | 'logistics' | 'exploration' | 'growth';
export interface AgentProfile {
  patience: number;
  assertiveness: number;
  sociability: number;
  motivations: { safety: number; duty: number; profit: number; growth: number; belonging: number };
  style: 'concise' | 'warm' | 'formal' | 'direct';
}
export type TaskCondition =
  | { type: 'repair'; when: 'before' | 'after'; locationId: string; hullPercent: number }
  | { type: 'rest'; when: 'before' | 'after'; locationId: string; minutes: number }
  | { type: 'reward'; when: 'after'; credits: number }
  | { type: 'escort'; when: 'before'; agentId: string };
export interface Commitment {
  id: string;
  contractId: string;
  agentId: string;
  condition: TaskCondition;
  status: 'pending' | 'fulfilled' | 'broken' | 'refunded';
  escrow: number;
  directiveId: string | null;
}
export type DecisionEvent = {
  id: string;
  kind:
    | 'chat'
    | 'request'
    | 'danger'
    | 'state'
    | 'opportunity'
    | 'manual'
    | 'configuration'
    | 'recovery';
  time: number;
};
export interface AgentMemory {
  id: number;
  time: number;
  kind: 'chat' | 'decision' | 'outcome' | 'danger';
  summary: string;
  entityId: string | null;
  salience: number;
}
export type AgentStateMetric =
  | 'fatigue'
  | 'stress'
  | 'resentment'
  | 'confidence'
  | 'morale'
  | 'trust';
export interface AgentStateDynamics {
  activity: 'work' | 'combat' | 'idle' | 'docked' | 'rest';
  fatigueRate: number;
  stressRate: number;
  resentmentRate: number;
  engagementTick: number | null;
  lastDangerAt: number;
  hullBands: number[];
  thresholds: string[];
  recent: {
    id: string;
    time: number;
    cause: string;
    changes: Partial<Record<AgentStateMetric, number>>;
  }[];
}
export interface Agent {
  /** The same stable actor ID is used by Operator and Assignment. */
  id: string;
  name: string;
  career: AgentCareer;
  personality: { riskTolerance: number; cooperation: number; discipline: number; ambition: number };
  profile: AgentProfile;
  psychology: { stress: number; confidence: number; resentment: number };
  longTermGoal: { activity: Activity; summary: string };
  taskPreferences: Record<Activity, number>;
  rewardCredits: number;
  feedbackEvents: string[];
  stateDynamics: AgentStateDynamics;
  skills: { battle: number; logistics: number; navigation: number };
  experience: number;
  trust: number;
  fatigue: number;
  morale: number;
  currentGoal: string;
  memory: AgentMemory[];
  relationships: Record<string, { trust: number; cooperation: number; lastInteraction: number }>;
  assignedShipId: string | null;
  originPersonnelId: string | null;
  modelConfig: { model: string | null; reasoningEffort: ReasoningEffort | null };
  enabled: boolean;
  status: 'online' | 'waiting' | 'executing' | 'error' | 'unassigned' | 'admiral' | 'offline';
  decision: {
    revision: number;
    pendingReasons: string[];
    nextAt: number;
    lastAt: number | null;
    lastChatId: number;
    lastAdmiralMessageId: number;
    failures: number;
    lastError: string | null;
    contextKey: string;
    dangerKey: string;
    events: DecisionEvent[];
  };
}
export interface ChatChannel {
  id: string;
  name: string;
  kind: 'command' | 'private' | 'reports';
  members: string[];
  readThrough: number;
}
export interface ChatMessage {
  id: number;
  sender: string;
  channelId: string;
  time: number;
  content: string;
  mentions: string[];
  kind: 'message' | 'request' | 'reply' | 'report' | 'danger' | 'error';
  purpose?: 'information' | 'acknowledgement' | 'request';
  replyTo?: number | null;
  origin?: 'admiral' | 'agent' | 'engine' | 'legacy';
  eventId?: string | null;
  requestId?: string | null;
  controlMode?: 'voluntary' | 'direct';
  responses?: Record<string, 'pending' | 'replied' | 'failed' | 'superseded' | 'cancelled'>;
}
export interface Objective {
  schemaVersion: 1;
  originInteractionId: string;
  issuerId: string;
  ownerAgentId: string | null;
  goal: ObjectiveGoal;
  constraints: { allowWormholes: boolean };
  completionCriteria: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  originalInstruction: string;
  id: string;
  agentId: string;
  messageId: number;
  channelId: string;
  kind: 'action' | 'assign' | 'construction' | 'surveyRoute' | 'cancel' | 'factionAssault' | 'loadReturn' | 'salvage';
  factionId?: 'orion';
  searchedTargets?: Record<string, number>;
  directiveMode?: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
  status: 'active' | 'blocked' | 'interrupted' | 'completed' | 'completed_partial' | 'cancelled' | 'failed';
  action: Action | null;
  targetId: string | null;
  shipId: string | null;
  facilityKind: Exclude<FacilityKind, 'base'> | null;
  sectors: SectorCoord[];
  sectorIndex: number;
  scannedSectorIndices: number[];
  allowWormholes: boolean;
  projectId: string | null;
  carrierAgentId: string | null;
  reason: string | null;
  controlMode: 'voluntary' | 'direct';
  consent: 'proposed' | 'accepted' | 'rejected' | 'negotiating' | 'withdrawn';
  conditions: TaskCondition[];
  conditionVersion: number;
  rounds: number;
  turnAgentId: string;
  creditsApproved: boolean;
}
export type TaskProposal = Objective;
export interface EscortRequest {
  id: string;
  requesterId: string;
  responderId: string;
  targetShipId: string;
  created: number;
  deadline: number;
  started: boolean;
  executionStarted: boolean;
  rescueArrivedAt?: number;
  status:
    | 'pending'
    | 'negotiating'
    | 'awaitingApproval'
    | 'accepted'
    | 'rejected'
    | 'completed'
    | 'failed'
    | 'cancelled';
  kind: 'escort' | 'team' | 'reinforce' | 'logistics' | 'handoff';
  action: Action | null;
  followUp: Action | null;
  parentTaskId: string | null;
  conditions: TaskCondition[];
  conditionVersion: number;
  rounds: number;
  turnAgentId: string;
  creditsApproved: boolean;
  explicitDeadline: boolean;
  reason: string | null;
}
export type CollaborationRequest = EscortRequest;
export interface AgentDecision {
  mode?: 'act' | 'continue' | 'wait' | 'clarify';
  goal: string;
  rationale: string;
  action: Action | null;
  messages: {
    channelId: string;
    content: string;
    mentions: string[];
    purpose?: ChatMessage['purpose'];
    replyTo?: number | null;
  }[];
  memory: string | null;
  waitMinutes: number;
  coordination:
    | { type: 'requestEscort'; agentId: string; targetShipId: string }
    | { type: 'answerEscort'; requestId: string; accept: boolean }
    | {
        type: 'requestTask';
        kind: CollaborationRequest['kind'];
        agentId: string;
        action: Action;
        followUp: Action | null;
        conditions: TaskCondition[];
      }
    | {
        type: 'answerRequest';
        requestId: string;
        version: number;
        response: 'accept' | 'reject' | 'counter' | 'withdraw';
        conditions: TaskCondition[];
        reason:
          | 'risk'
          | 'fatigue'
          | 'damage'
          | 'conflict'
          | 'preference'
          | 'relationship'
          | 'promise';
      }
    | {
        type: 'answerTask';
        taskId: string;
        version: number;
        response: 'accept' | 'reject' | 'counter' | 'withdraw';
        conditions: TaskCondition[];
        reason:
          | 'risk'
          | 'fatigue'
          | 'damage'
          | 'conflict'
          | 'preference'
          | 'relationship'
          | 'promise';
      }
    | null;
  social?: {
    type: 'support' | 'disagree' | 'mediate' | 'compete' | 'preference';
    messageId: number;
    agentId: string | null;
    activity: Activity | null;
  } | null;
}
export type JourneyLeg =
  | { type: 'warp'; destination: Point; route: RouteKind; path: Point[] }
  | { type: 'wormhole'; wormholeId: string; entrance: Point; destination: Point };
export interface JourneyPlan {
  destination: Point;
  legs: JourneyLeg[];
  eta: number;
  risk: number;
  score: number;
  distance: number;
  unknownDistance: number;
}
export interface JourneyProgress extends JourneyPlan {
  legIndex: number;
  transitWork: number;
}
/** Only a surveyed, discovered passage exposes its confirmed exit. */
export type KnownWormhole = Omit<Wormhole, 'exit' | 'exitSector'> & { exit: Point | null };
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
  starClass: 'M' | 'K' | 'G' | 'F' | 'A' | 'giant' | 'neutron';
}
export interface Body extends Point {
  id: string;
  name: string;
  systemId: string;
  kind: 'planet' | 'moon' | 'belt' | 'resource' | 'anomaly' | 'ruins' | 'derelict';
  category: string;
  population: number;
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
  defenseProfile?: 'orionHQ' | 'orionSupply';
  owner: FactionId;
  siteId: string | null;
  stock: Stock;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  core: number;
  attackedAt: number;
  lastAttackerId: string | null;
  cooldown: number;
  distress: boolean;
  discovered: boolean;
  production: number;
  capacity: Stock;

  storageFull: boolean;
  extracted: number;
  colony: ColonyState | null;
  occupation: 'ruined' | 'secured' | 'rebuilding' | null;
}
export const CAREERS = [
  'battle',
  'science',
  'diplomacy',
  'logistics',
  'security',
  'commander',
] as const;
export type Career = (typeof CAREERS)[number];
export interface ColonyState {
  population: number;
  housing: number;
  stability: number;
  morale: number;
  security: number;
  industry: number;
  science: number;
  commanderId: string | null;
  nextCandidate: number;
  contamination: number;
  quarantine: boolean;
  development: { kind: 'housing' | 'industry' | 'science' | 'security'; work: number } | null;
}
export interface Personnel {
  id: string;
  name: string;
  originId: string;
  career: Career;
  experience: number;
  skills: Record<Career, number>;
  status: 'candidate' | 'training' | 'available' | 'assigned' | 'rejected' | 'missing';
  training: number;
  locationId: string;
  posting: { type: 'ship' | 'colony'; id: string } | null;
}
export interface TaskGroup {
  id: string;
  name: string;
  shipIds: string[];
  flagshipId: string;
  spacing: number;
}
export interface StandingOrders {
  roe: ROE;
  retreatHull: number;
  retreatShield: number;
  retreatCore: number;
  photonThreshold: number;
  quantumThreshold: number;
  maxPursuit: number;
  allowNeutral: boolean;
  allowRomulan: boolean;
  autoEscort: boolean;
  respondDistress: boolean;
  protectCivilian: boolean;
  protectFreighter: boolean;
  protectColony: boolean;
  serviceWhenDocked: boolean;
}
export interface Wormhole extends Point {
  id: string;
  name: string;
  sectorId: string;
  discovered: boolean;
  surveyed: boolean;
  exit: Point;
  exitSector: SectorCoord;
  stability: number;
  stable: boolean;
  transits: number;
}
export type WorldEventKind =
  | 'wormhole'
  | 'plague'
  | 'invasion'
  | 'accident'
  | 'distress'
  | 'refugees'
  | 'discovery'
  | 'derelict'
  | 'diplomatic';
export interface WorldEvent {
  id: string;
  kind: WorldEventKind;
  subjectId: string;
  created: number;
  deadline: number;
  stage: 'reported' | 'responding' | 'resolved' | 'failed';
  evidence: string;
  choice: string | null;
  work: number;
  population: number;
  carrierId: string | null;
  targetId: string | null;
  assetIds: string[];
  followUpId: string | null;
  outcome: string;
}
/** Derived public response information; never persisted in WorldState. */
export interface MineAccidentResponse {
  workRequired: number;
  materialRequired: number;
  availableAtSite: number;
  responders: {
    shipId: string;
    phase: 'travelling' | 'working' | 'awaitingMaterials';
    cargoMaterials: number;
    shortfall: number;
  }[];
}
export interface CivilianShip extends Ship {
  homeId: string;
  orderId: string | null;
  phase: 'idle' | 'loading' | 'delivery' | 'return';
  work: number;
}
export interface TradeOrder {
  id: string;
  direction: 'buy' | 'sell';
  cargoKind: CargoKind;
  amount: number;
  delivered: number;
  loaded: number;
  lost?: number;
  price: number;
  state: 'waiting' | 'loading' | 'delivery' | 'complete' | 'lost';
  carrierId: string | null;
}
export interface TradeState {
  stock: Stock;
  credits: number;
  capacity: Stock;
  depot: Point;
  orders: TradeOrder[];
}
export type Action =
  | { type: 'MOVE'; point: Point }
  | { type: 'EXPLORE'; sector: SectorCoord; approach: 'remote' | 'close' }
  | { type: 'SURVEY'; targetId: string; approach: 'remote' | 'close'; deep: boolean }
  | { type: 'RETURN' }
  | { type: 'LOAD'; sourceId: string; cargoKind: CargoKind; route: RouteKind }
  | { type: 'ASSIST_EVENT'; targetId: string }
  | { type: 'TRANSIT'; targetId: string }
  | { type: 'CAPTURE'; targetId: string }
  | { type: 'HAIL'; targetId: string; message: 'greeting' | 'withdraw' | 'deescalate' }
  | {
      type: 'HAUL';
      sourceId: string;
      targetId: string;
      cargoKind: CargoKind;
      amount: number;
      route: RouteKind;
      repeat: boolean;
      loadPolicy?: 'auto' | 'fixed';
    }
  | { type: 'ATTACK_SET'; targetIds: string[] }
  | {
      type: 'ATTACK' | 'DISABLE' | 'DRIVE_OFF' | 'INTERCEPT' | 'SHADOW';
      targetId: string;
      subsystem?: 'engines' | 'weapons';
    }
  | { type: 'ESCORT'; targetId: string }
  | { type: 'PATROL'; targetId: string; duration: number }
  | { type: 'REST'; targetId: string; duration: number }
  | { type: 'RETREAT' | 'DOCK'; targetId: string }
  | { type: 'REPAIR'; targetId: string }
  | { type: 'REARM'; targetId: string; load: Ammunition }
  | { type: 'REFIT'; targetId: string; moduleId: ModuleId; remove: boolean }
  | { type: 'UNLOAD'; targetId: string }
  | { type: 'RECOVER'; targetId: string };
export interface Directive {
  originInteractionId?: string;
  objectiveId?: string;
  submissionKey?: string;
  id: string;
  action: Action;
  created: number;
  phase: string;
  work: number;
  moved: number;
  carried: number;
  delivered: number;
  lost?: number;
  reserved: Stock;
  paidCredits: number;
  search: number;
  note: string;
  source: 'admiral' | 'agent' | 'standing';
  actorId: string;
  executorAgentId: string | null;
  sourceMessageId: number | null;
  taskId: string | null;
  contractId: string | null;
  cycle: number;
  controlMode: 'direct' | 'voluntary' | 'autonomous';
  allowWormholes: boolean;
  journey: JourneyProgress | null;
  groupOrderId: string | null;
  groupSlot: number;
  groupTotal: number;
  groupSpacing: number;
  origin: Point;
  targetIndex?: number;
  unconfirmedTargets?: string[];
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
  standing: StandingOrders;
  piracyPolicy: 'preserveShip' | 'preserveCargo' | 'manual';
  path: Point[];
  heading: number;
  cargo: Stock;
  passengers: number;
  cooldowns: Record<string, number>;
  ammoAlertActive?: boolean;
  lastAttackerId: string | null;
  attackedAt: number;
  scanUntil: number;
  cloak: 'off' | 'on' | 'decloaking';
  cloakUntil: number;
  emergencyRetreat: { point: Point; started: number } | null;
  tracking: { targetId: string; position: Point; lastSeen: number; live: boolean } | null;
}
export interface Enemy extends Ship {
  homeId: string;
  role: 'scout' | 'raider' | 'warbird' | 'interceptor' | 'corsair' | 'smuggler';
  intent:
    | 'observe'
    | 'raid'
    | 'probe'
    | 'patrol'
    | 'retreat'
    | 'docked'
    | 'assemble'
    | 'ambush'
    | 'extort'
    | 'disable'
    | 'board'
    | 'transfer';
  targetId: string | null;
  destination: Point | null;
  nextDecision: number;
  visited: string[];
  loot: number;
  localReports: ThreatReport[];
  lastHostileAt: number;
  lastHostileTargetId: string | null;
  counterTracking: {
    position: Point;
    watchers: Record<
      string,
      { exposure: number; identified: boolean; lastSeen: number; position: Point; bearing: number }
    >;
    evading: boolean;
    waypoints: Point[];
    lastSeen: number;
    checkedAt: number;
    serial: number;
  };
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
  stance: 'observe' | 'probe' | 'patrol' | 'reinforce' | 'escalate' | 'withdraw';
  pressure: number;
}
/** Private faction observations; never included in public snapshots. */
export interface OrionReport extends Point {
  id: string;
  observerId: string;
  seenAt: number;
  kind: 'ship' | 'facility';
  velocity: Point;
  cargoEstimate: number;
  value: number;
  defense: number;
  classId: ShipClassId | null;
  escorts: { id: string; strength: number; x: number; y: number }[];
}
export type OrionPhase =
  | 'assemble'
  | 'deploy'
  | 'ambush'
  | 'extort'
  | 'disable'
  | 'board'
  | 'withdraw'
  | 'resupply';
export interface OrionOperation {
  id: string;
  targetId: string;
  members: { shipId: string; duty: 'intercept' | 'flank' | 'loot' | 'cover' | 'transport' }[];
  phase: OrionPhase;
  status: 'active' | 'complete' | 'aborted';
  created: number;
  phaseAt: number;
  report: OrionReport;
  motion: Point & { observedAt: number };
  rendezvous: Point;
  intercept: Point;
  incidentId: string | null;
  work: number;
  transferWork: number;
  initialCargo: number;
  limit: number;
  taken: number;
  reason: string;
}
/** Received communications and own telemetry; never private enemy intent. */
export interface PiracyIncident {
  id: string;
  shipId: string;
  created: number;
  deadline: number;
  demand: number;
  response: 'pending' | 'comply' | 'refuse';
  responseSource: 'policy' | 'admiral' | null;
  stage: 'demand' | 'transferring' | 'attacked' | 'boarding' | 'resolved';
  boardingWork: number;
  lost: Stock;
  attackerIds: string[];
  outcome: string;
  notifiedAgentIds: string[];
}
export interface OrionJob {
  id: string;
  kind: 'ship' | 'ammo' | 'supply' | 'hq';
  locationId: string | null;
  builderId: string | null;
  point: Point;
  classId: ShipClassId | null;
  work: number;
  duration: number;
  credits: number;
  materials: number;
  status: 'active' | 'complete' | 'lost';
}
export interface OrionLogistics {
  shipId: string;
  sourceId: string;
  targetId: string;
  phase: 'loading' | 'delivery';
  work: number;
  manifest: Stock;
}
export interface OrionState {
  intelligence: Record<string, OrionReport[]>;
  patrols: Record<string, { anchor: Point; leg: number }>;
  operations: OrionOperation[];
  jobs: OrionJob[];
  logistics: OrionLogistics[];
  servicedLoot: Record<string, Stock>;
  lootCargo: Record<string, Stock>;
  provisioning: { shipId: string; sourceId: string | null; headquarters: boolean }[];
  robbedTargets: Record<string, { cargoEstimate: number; seenAt: number; departed: boolean }>;
  nextPlan: number;
  market: { credits: number; stock: Stock; capacity: Stock };
  realizedIncome: number;
  ledger: {
    id: string;
    time: number;
    kind: string;
    entityId: string;
    credits: number;
    goods: Stock;
  }[];
  shipLosses: {
    id: string;
    time: number;
    cargo: Stock;
    ammunition: Ammunition;
    classId: ShipClassId;
  }[];
}
export interface Cost {
  credits: number;
  materials: number;

  specialFinds: number;
}
export interface Construction extends Point {
  id: string;
  name: string;
  kind: FacilityKind;
  siteId: string;
  refitLocationId: string | null;
  stock: Stock;
  capacity: Stock;
  cost: Cost;
  work: number;
  duration: number;
  complete: boolean;
}
export interface IndustryJob {
  id: string;
  locationId: string;
  kind: 'ship' | 'upgrade' | 'manufacture';
  key: string;
  amount: number;
  work: number;
  duration: number;
  complete: boolean;
  cancelled: boolean;
  name: string;
}
export interface Operator {
  id: string;
  name: string;
  kind: 'rules' | 'agent';
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
  'newContact',
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
  | PublicSimulationEvent
  | { type: 'dayBoundary'; day: number; tick: number; time: number }
  | { type: 'criticalPause'; reasons: CriticalReason[] }
  | { type: 'shipDestroyed'; shipId: string; operatorIds: string[]; tick: number }
  | { type: 'commandLost'; tick: number };
/** Only completed, visible own-ship actions may be delivered as UI events. */
export type PublicSimulationEvent = {
  type: 'shipTransited';
  shipId: string;
  destination: Point;
  tick: number;
};
export interface Wreck extends Point {
  sourceShipId?: string;
  sourceClassId?: ShipClassId | null;
  id: string;
  name: string;
  stock: Stock;
  discovered: boolean;
}
/** Authoritative reconnaissance evidence; hidden location identifiers never cross IPC. */
export interface SiteIntel extends Point {
  id: string;
  locationId: string;
  progress: number;
  lastSeen: number;
}
export interface WorldState {
  version: 16;
  agentRuntime: RuntimeState;
  orion: OrionState;
  piracyIncidents: PiracyIncident[];
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
  agents: Agent[];
  chatChannels: ChatChannel[];
  chatMessages: ChatMessage[];
  objectives: Objective[];
  escortRequests: EscortRequest[];
  commitments: Commitment[];
  settledOutcomes: string[];
  nextChat: number;
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
  siteIntel: SiteIntel[];
  recoveredVeil: boolean;
  contactAlerts: { contactId: string; lastAlertAt: number; hostileAlerted: boolean }[];
  dismissedMarkerIds: string[];
  factions: { orion: FactionState; romulan: FactionState };
  tension: number;
  resources: { credits: number };
  upgrades: Record<UpgradeId, number>;
  productionDiscountUnlocked: boolean;
  renamedEntityIds: string[];
  groups: TaskGroup[];
  personnel: Personnel[];
  events: WorldEvent[];
  wormholes: Wormhole[];
  civilians: CivilianShip[];
  trade: TradeState;
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
  agentRuntime: RuntimeState;
  version: 16;
  piracyIncidents: PiracyIncident[];
  tick: number;
  time: number;
  paused: boolean;
  speed: SimulationSpeed;
  status: WorldState['status'];
  pauseReasons: CriticalReason[];
  commander: WorldState['commander'];
  operators: Operator[];
  assignments: Assignment[];
  agents: Agent[];
  chatChannels: ChatChannel[];
  chatMessages: ChatMessage[];
  objectives: Objective[];
  escortRequests: EscortRequest[];
  commitments: Commitment[];
  losses: LossRecord[];
  ships: Ship[];
  contacts: IntelRecord[];
  siteContacts: { id: string; x: number; y: number; progress: number; lastSeen: number }[];
  sectors: Sector[];
  systems: StarSystem[];
  bodies: Body[];
  locations: Location[];
  projects: Construction[];
  jobs: IndustryJob[];
  wrecks: Wreck[];
  resources: WorldState['resources'];
  baseResources: { credits: number; stock: Stock; available: Stock; reserved: Stock };
  inventories: { locationId: string; available: Stock; reserved: Stock }[];
  production: {
    discounted: boolean;
    ships: Record<string, { original: Cost; actual: Cost }>;
    ammunition: Record<'photon' | 'quantum', { original: Cost; actual: Cost }>;
  };
  renamedEntityIds: string[];
  mapMarkers: { dismissedIds: string[]; removableIds: string[] };
  upgrades: WorldState['upgrades'];
  tension: number;
  communications: Communication[];
  logs: LogEntry[];
  history: HistoryEntry[];
  beams: Beam[];
  opportunities: Opportunity[];
  armory: { stock: Ammunition; reserved: Ammunition };
  groups: TaskGroup[];
  personnel: Personnel[];
  events: (WorldEvent & { accidentResponse?: MineAccidentResponse })[];
  wormholes: KnownWormhole[];
  civilians: CivilianShip[];
  trade: TradeState;
}
export type Command =
  | { type: 'respondPiracy'; incidentId: string; shipId: string; response: 'comply' | 'refuse' }
  | { type: 'setPiracyPolicy'; shipId: string; policy: Ship['piracyPolicy'] }
  | { type: 'interpretInteraction'; agentId: string; messageId: number }
  | { type: 'assignAgent'; agentId: string; shipId: string | null }
  | { type: 'configureAgent'; agentId: string; modelConfig: Agent['modelConfig']; enabled: boolean }
  | { type: 'retryAgent'; agentId: string; messageId?: number }
  | { type: 'cancelAgentReply'; agentId: string; messageId: number }
  | { type: 'modifyCurrentTask'; shipId: string; action: Action }
  | {
      type: 'proposeDirective';
      shipIds: string[];
      mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
      action: Action;
    }
  | {
      type: 'sendChat';
      channelId: string;
      content: string;
      mentions: string[];
      controlMode?: 'voluntary' | 'direct';
    }
  | {
      type: 'resolveProposal';
      contractId: string;
      version: number;
      response: 'approve' | 'reject' | 'cancel' | 'takeover';
    }
  | { type: 'readChat'; channelId: string; throughId: number }
  /** Main-process ports only; the Admiral/renderer cannot impersonate an Agent. */
  | {
      type: 'agentDecision';
      agentId: string;
      revision: number;
      observedAt?: number;
      decision: AgentDecision;
    }
  | {
      type: 'agentDecisionState';
      agentId: string;
      revision: number;
      state: 'waiting' | 'error' | 'offline' | 'ready';
      error: string | null;
    }
  | { type: 'dismissMapMarker'; entityId: string }
  | {
      type: 'issueDirective';
      shipIds: string[];
      mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
      action: Action;
    }
  | {type:'submitObjective';shipId:string;goal:ObjectiveGoal;authorizationMode:'direct'|'voluntary';instruction:string}
  | {type:'cancelObjective'|'resumeObjective';objectiveId:string;expectedRevision:number}
  | {type:'reviseObjective';objectiveId:string;expectedRevision:number;goal:ObjectiveGoal;instruction:string}
  | { type: 'cancelDirective'; shipId: string }
  | { type: 'standingOrders'; shipId: string; orders: StandingOrders }
  | { type: 'setCloak'; shipId: string; enabled: boolean }
  | { type: 'createGroup'; name: string; shipIds: string[]; flagshipId: string; spacing: number }
  | {
      type: 'updateGroup';
      groupId: string;
      name: string;
      shipIds: string[];
      flagshipId: string;
      spacing: number;
    }
  | { type: 'deleteGroup'; groupId: string }
  | {
      type: 'issueGroupDirective';
      groupId: string;
      mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
      action: Action;
    }
  | { type: 'candidate'; personnelId: string; accept: boolean; career: AgentCareer }
  | {
      type: 'assignPersonnel';
      personnelId: string;
      targetId: string;
      targetType: 'ship' | 'colony';
    }
  | {
      type: 'developColony';
      locationId: string;
      kind: 'housing' | 'industry' | 'science' | 'security';
    }
  | {
      type: 'respondEvent';
      eventId: string;
      choice:
        | 'assist'
        | 'quarantine'
        | 'liftQuarantine'
        | 'accept'
        | 'reject'
        | 'withdraw'
        | 'stabilize';
      targetId?: string;
    }
  | { type: 'tradeStock'; direction: 'buy' | 'sell'; cargoKind: CargoKind; amount: number }
  | { type: 'renameEntity'; entityId: string; name: string }
  | { type: 'startConstruction'; siteId: string; kind: Exclude<FacilityKind, 'base'>; name: string }
  | { type: 'startBaseRefit'; locationId: string; name: string }
  | { type: 'buildShip'; classId: ShipClassId; name: string; locationId?: string }
  | { type: 'upgrade'; upgradeId: UpgradeId; locationId?: string }
  | { type: 'manufacture'; cargoKind: 'photon' | 'quantum'; amount: number; locationId?: string }
  | { type: 'sellStock'; cargoKind: CargoKind; amount: number }
  | { type: 'repairFacility'; locationId: string }
  | { type: 'acknowledge'; communicationId: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: SimulationSpeed };
export type SessionCommand = { type: 'restorePreviousDay' | 'beginNewFrontier' };
export type CommandResult = { ok: boolean; reason: string };
interface ObservationData {
  piracyIncidents: PiracyIncident[];
  rescueOptions: { agentId: string; action: Action }[];
  time: number;
  operatorId: string;
  self: Agent | null;
  ship: Ship | null;
  fleet: {
    id: string;
    name: string;
    career: AgentCareer;
    assignedShipId: string | null;
    status: Agent['status'];
    currentGoal: string;
  }[];
  ownShips: Ship[];
  currentTask: Directive | null;
  objective: Objective | null;
  runtimeTask: import('./agent-runtime/model').TaskState|null;
  taskProposals: Objective[];
  actionAvailability: { action: Action; autonomous: boolean; reason: string | null }[];
  constructionOptions: {
    siteId: string;
    kind: Exclude<FacilityKind, 'base'>;
    credits: number;
    materials: number;
    allowed: boolean;
    reason: string;
  }[];
  contacts: IntelRecord[];
  sectors: Sector[];
  systems: StarSystem[];
  bodies: Body[];
  locations: Location[];
  projects: Construction[];
  wormholes: KnownWormhole[];
  journeys: { targetId: string; plans: JourneyPlan[] }[];
  inventories: SnapshotData['inventories'];
  logisticsNeeds: { targetId: string; cargoKind: CargoKind; amount: number; sourceIds: string[] }[];
  company: {
    credits: number;
    upgrades: WorldState['upgrades'];
    tension: number;
    status: WorldState['status'];
  };
  recentChat: ChatMessage[];
  channels: ChatChannel[];
  escortRequests: EscortRequest[];
  commitments: Commitment[];
  decisionContext: {
    willingness: number;
    riskLimit: number;
    conflicts: string[];
    preferredActivities: Activity[];
    preferredPeers: string[];
    growthModules: ModuleId[];
    preparation: {
      hullPercent: number;
      freeCargo: number;
      repairMaterials: number;
      facilities: { id: string; distance: number; materialsAvailable: number }[];
    } | null;
  };
  opportunities: Opportunity[];
  legalActions: string[];
  actionExamples: Action[];
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
