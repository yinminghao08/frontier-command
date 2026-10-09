import { bindAssignment } from './assignment';
import { CognitionGateway } from './cognition';
import { advanceTrade } from './trade';
import { advanceEvents } from './world-events';
import { FIXED_DELTA, TICKS_PER_DAY, gameCalendar } from './clock';
import { createWorld } from './data';
import * as commands from './command-system';
import { commandSchema } from './commands';
import * as projection from './projection';
import { advanceShip } from './execution';
import { advanceEnemy, advanceFactions } from './threats';
import { advanceOrion } from './orion/tactics';
import { advancePiracyPolicies } from './orion/piracy';
import { advanceEconomy } from './services';
import { updateSensors } from './sensors';
import { applyDamage, fire } from './combat';
import { advanceAgents, agentOutcome } from './agents';
import { appendChat, REPORT_CHANNEL, SYSTEM_ACTOR, wakeAgent } from './chat';
import { contractDirectiveOutcome } from './contracts';
import { FrontierAgentRuntime } from './agent-runtime/runtime';
import type {
  Action,
  AgentControllerPort,
  Beam,
  CriticalReason,
  Location,
  Ship,
  SimulationEvent,
  WorldState,
} from './types';
export { FIXED_DELTA } from './clock';
export { dist } from './navigation';
export class SimulationEngine {
  readonly cognition = new CognitionGateway(this);
  state: WorldState;
  runtime: FrontierAgentRuntime;
  pending: CriticalReason[] = [];
  pendingEvents: SimulationEvent[] = [];
  /** Engine-internal dispatch context. Never exposed through observation or IPC. */
  executingObjectiveId: string | null = null;
  executingContractId: string | null = null;
  constructor(world = createWorld()) {
    this.state = structuredClone(world);
    for (const agent of this.state.agents) bindAssignment(this.state, agent);
    this.runtime = new FrontierAgentRuntime(this);
    for (const a of this.state.agents)
      if (a.status === 'waiting') wakeAgent(a, 'recovery', this.state.time, true);
  }
  get base() {
    return this.state.locations.find((l) => l.id === 'base')!;
  }
  random = () => {
    this.state.seed = (Math.imul(this.state.seed, 1664525) + 1013904223) >>> 0;
    return this.state.seed / 4294967296;
  };
  log(text: string, level: 'info' | 'success' | 'warning' | 'danger' = 'info') {
    const w = this.state;
    w.logs.push({ id: w.nextLog++, time: w.time, text, level });
    if (w.logs.length > 180) w.logs.shift();
  }
  report(
    text: string,
    entityId: string | null,
    priority: 'normal' | 'high' | 'urgent' = 'normal',
    category: 'request' | 'report' | 'threat' | 'decision' = 'report',
  ) {
    const w = this.state;
    w.communications.push({
      id: w.nextComms++,
      time: w.time,
      text,
      entityId,
      priority,
      category,
      read: false,
    });
    appendChat(
      this,
      SYSTEM_ACTOR,
      REPORT_CHANNEL,
      text,
      [],
      priority === 'urgent' || category === 'threat'
        ? 'danger'
        : category === 'request' || category === 'decision'
          ? 'request'
          : 'report',
      { origin: 'engine', eventId: 'comms:' + (w.nextComms - 1) },
    );
    if (w.communications.length > 100) w.communications.shift();
    this.log(text, priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'info');
  }
  record(kind: string, text: string, entityId: string | null, communicate = true) {
    this.state.history.push({
      id: this.state.nextHistory++,
      time: this.state.time,
      kind,
      text,
      entityId,
    });
    const agentTask = this.state.ships.some(
      (s) => s.id === entityId && (s.current?.source === 'agent' || !!s.current?.executorAgentId),
    );
    if (communicate && !agentTask) this.report(text, entityId);
    else this.log(text);
  }
  critical(kind: CriticalReason['kind'], entityId: string, message: string) {
    if (!this.pending.some((r) => r.kind === kind && r.entityId === entityId))
      this.pending.push({ kind, entityId, message, tick: this.state.tick, time: this.state.time });
  }
  finishCritical(): SimulationEvent[] {
    if (!this.pending.length) return [];
    const reasons = this.pending.splice(0);
    this.state.paused = true;
    this.state.pauseReasons.push(...reasons);
    return [{ type: 'criticalPause', reasons: structuredClone(reasons) }];
  }
  isCommandLost() {
    return this.state.status === 'commandLost';
  }
  validate = commands.validate.bind(this);
  dispatchCommand = (command: unknown, actorId = 'commander') => {
    const parsed = commandSchema.safeParse(command);
    const result =
      parsed.success &&
      (parsed.data.type === 'issueDirective' || parsed.data.type === 'issueGroupDirective') &&
      !this.executingObjectiveId
        ? this.runtime.startCommand(parsed.data, actorId)
        : commands.dispatchCommand.call(this, command, actorId);
    if (
      result.ok &&
      !this.executingObjectiveId &&
      (!parsed.success ||
        !['pause', 'speed', 'acknowledge', 'readChat', 'dismissMapMarker'].includes(
          parsed.data.type,
        ))
    )
      this.runtime.drain();
    return result;
  };
  submitAction = commands.submitAction.bind(this);
  snapshot = projection.snapshot.bind(this);
  getObservation = projection.getObservation.bind(this);
  cognitionPort(agentId: string) {
    return Object.freeze({
      prepare: () => this.cognition.prepare(agentId),
      cancel: () => this.cognition.cancel(agentId),
    });
  }
  controllerPort(operatorId: string): AgentControllerPort {
    return Object.freeze({
      getObservation: () => this.getObservation(operatorId),
      submitAction: (action: Action) => this.submitAction(operatorId, action),
    });
  }
  hit = (target: Ship | Location, amount: number, attacker?: Ship) =>
    applyDamage(this, target, amount, attacker);
  fire = (
    s: Ship,
    t: Ship | Location,
    disable?: 'engines' | 'weapons' | 'suppression' | 'warning',
  ) => fire(this, s, t, disable);
  berth(s: Ship) {
    const i = this.state.ships.findIndex((x) => x.id === s.id);
    return { x: this.base.x + ((i % 8) - 3.5) * 24, y: this.base.y + 40 + Math.floor(i / 8) * 22 };
  }
  complete(s: Ship, text: string, failed = false) {
    const old = s.current;
    if (old) this.runtime.outcome(s, old, text, failed);
    if (old) agentOutcome(this, s, old, text, failed);
    if (old && !old.objectiveId) contractDirectiveOutcome(this, old.id, old.contractId, failed);
    s.current = null;
    s.tracking = null;
    s.path = [];
    s.status = 'idle';
    if (old)
      this.record(
        failed ? 'actionFailed' : 'action',
        s.name +
          ' / ' +
          old.action.type +
          ' / ' +
          old.source.toUpperCase() +
          ' / ' +
          old.actorId +
          ' / ' +
          text,
        s.id,
        old.source !== 'agent' && !old.executorAgentId,
      );
    const next = s.suspended.pop() ?? s.queue.shift();
    if (next) {
      const valid = commands.validateContinuation(this, s, next);
      if (valid.ok) {
        s.current = next;
        s.path = [];
        s.status = 'active';
        next.note = '接续：' + text;
      } else {
        s.current = next;
        this.complete(s, '目标无法接续：' + valid.reason, true);
      }
    }
  }
  step(fixedDelta = FIXED_DELTA): SimulationEvent[] {
    if (fixedDelta !== FIXED_DELTA) throw Error('Simulation requires fixed 0.1 game-minute steps');
    const w = this.state;
    if (w.paused || this.isCommandLost()) return [];
    w.tick++;
    w.time = w.tick / 10;
    const events: SimulationEvent[] =
      w.tick % TICKS_PER_DAY === 0
        ? [{ type: 'dayBoundary', day: gameCalendar(w.tick).day, tick: w.tick, time: w.time }]
        : [];
    w.beams = w.beams.filter((b) => b.expires > w.time);
    if (w.tick % 10 === 0) updateSensors(this);
    if (this.pending.some((r) => r.kind === 'newContact'))
      return [...events, ...this.pendingEvents.splice(0), ...this.finishCritical()];
    advanceEconomy(this, fixedDelta);
    advancePiracyPolicies(this);
    for (const s of [...w.ships]) {
      if (this.isCommandLost()) break;
      advanceShip(this, s, fixedDelta);
    }
    advanceOrion(this, fixedDelta);
    for (const s of [...w.enemies]
      .filter((s) => s.factionId === 'romulan')
      .sort((a, b) => a.id.localeCompare(b.id))) {
      if (this.isCommandLost()) break;
      advanceEnemy(this, s, fixedDelta);
    }
    advanceTrade(this, fixedDelta);
    advanceFactions(this, fixedDelta);
    advanceEvents(this, fixedDelta);
    advanceAgents(this, fixedDelta);
    this.runtime.drain();
    return [...events, ...this.pendingEvents.splice(0), ...this.finishCritical()];
  }
  advanceFrame(afterStep?: (events: SimulationEvent[], state: WorldState) => void) {
    const events: SimulationEvent[] = [];
    const speed = this.state.speed;
    for (let i = 0; i < speed && !this.state.paused; i++) {
      const next = this.step();
      afterStep?.(next, this.state);
      events.push(...next);
    }
    return events;
  }
  beam(attacker: Ship | Location, target: Ship | Location, weapon: string) {
    const b: Beam = {
      from: { x: attacker.x, y: attacker.y },
      to: { x: target.x, y: target.y },
      enemy:
        'factionId' in attacker
          ? attacker.factionId !== 'starfleet'
          : attacker.owner !== 'starfleet',
      weapon,
      expires: this.state.time + 0.4,
    };
    this.state.beams.push(b);
  }
}
