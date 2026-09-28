import type { FactionId, ContactFactionId } from './definitions/factions';
import type { ShipClassId } from './definitions/ships';
import type { ResourceId } from './definitions/resources';
export type Point = { x: number; y: number };
export type MissionKind = 'explore' | 'supply' | 'patrol';
export type Phase =
  | 'available'
  | 'outbound'
  | 'working'
  | 'decision'
  | 'returning'
  | 'complete'
  | 'failed';
export type ShipStatus = 'docked' | 'mission' | 'returning' | 'holding' | 'disabled' | 'repairing';
export type Route = 'safe' | 'fast';
export type Order = 'mission' | 'hold' | 'return' | 'engage';
export interface Commander {
  id: string;
  name: string;
  rank: string;
}
export interface Operator {
  id: string;
  shipId: string;
  kind: 'rules';
  name: string;
}
export interface Location extends Point {
  id: string;
  name: string;
  label: string;
  kind: 'base' | 'colony' | 'outpost' | 'anomaly' | 'border';
  supply: number;
}
export interface Ship extends Point {
  id: string;
  name: string;
  registry: string;
  role: string;
  classId: ShipClassId;
  factionId: FactionId;
  science: number;
  capacity: number;
  power: number;
  speed: number;
  hull: number;
  shield: number;
  maxShield: number;
  heading: number;
  throttle: number;
  status: ShipStatus;
  order: Order;
  missionId: string | null;
  targetId: string | null;
  path: Point[];
  trail: Point[];
  cooldown: number;
  cargo: number;
  repair: number;
  tow: number;
  emergency: boolean;
  helm: { turn: number; throttle: number };
}
export interface Mission {
  id: string;
  name: string;
  kind: MissionKind;
  locationId: string;
  brief: string;
  requirement: string;
  attention: string;
  risk: string;
  duration: number;
  phase: Phase;
  shipId: string | null;
  route: Route;
  started: number;
  work: number;
  decisionAt: number;
  choice: 'remote' | 'close' | null;
  deadline: number;
  cargoRequired: number;
  settled: boolean;
  run: number;
  reward: number;
  result: string;
  contactId: string | null;
  damage: number;
}
export interface Contact extends Point {
  id: string;
  faction: ContactFactionId;
  name: string;
  detected: boolean;
  identified: boolean;
  hostile: boolean;
  shield: number;
  hull: number;
  retreating: boolean;
  missionId: string | null;
  cooldown: number;
  created: number;
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
  expires: number;
}
export interface WorldState {
  version: 2;
  tick: number;
  time: number;
  seed: number;
  initialSeed: number;
  paused: boolean;
  speed: 1 | 2 | 4;
  manualShipId: string | null;
  commander: Commander;
  operators: Operator[];
  ships: Ship[];
  missions: Mission[];
  locations: Location[];
  contacts: Contact[];
  resources: Record<ResourceId, number>;
  threat: number;
  logs: LogEntry[];
  nextLog: number;
  nextContact: number;
  nextIncursion: number;
  beams: Beam[];
}
export type Command =
  | { type: 'dispatch'; shipId: string; missionId: string; route: Route }
  | { type: 'route'; shipId: string; route: Route }
  | { type: 'investigate'; shipId: string; choice: 'remote' | 'close' }
  | {
      type: 'recall' | 'scan' | 'repair' | 'takeControl' | 'fire' | 'hold' | 'resume';
      shipId: string;
    }
  | { type: 'hail' | 'engage' | 'target'; shipId: string; targetId: string }
  | { type: 'releaseControl'; shipId: string; resume: boolean }
  | { type: 'helm'; shipId: string; turn: number; throttle: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: 1 | 2 | 4 }
  | { type: 'renew'; missionId: string };
export type CommandResult = { ok: boolean; reason: string };
export type Snapshot = Omit<WorldState, 'contacts' | 'seed' | 'nextIncursion'> & {
  contacts: Contact[];
};
export interface Observation {
  time: number;
  operatorId: string;
  ship: Ship;
  contacts: Contact[];
  missions: Mission[];
  resources: WorldState['resources'];
  legalActions: string[];
}

/** Controller adapters receive only this port, never the writable engine state. */
export interface AgentControllerPort {
  getObservation(): Observation | null;
  dispatchCommand(command: Command): CommandResult;
}
