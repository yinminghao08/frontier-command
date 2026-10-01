import { FIXED_DELTA, TICKS_PER_DAY, gameCalendar } from './clock';
import * as command_system from './command-system';
import { createWorld, makeEnemy } from './data';
import { RULES } from './definitions/rules';
import { type WeaponDefinition } from './definitions/ships';
import * as execution from './execution';
import { applyDamage } from './lifecycle';
import * as order_system from './order-system';
import * as projection from './projection';
import { observe, updateSensors } from './sensors';
import { advanceLogistics } from './services';
import type {
  AgentControllerPort,
  Command,
  ControllerIntent,
  CriticalReason,
  Enemy,
  IntelRecord,
  Location,
  LogEntry,
  Point,
  Ship,
  SimulationEvent,
  WorldState,
} from './types';
export { FIXED_DELTA } from './clock';
export { dist } from './navigation';
export class SimulationEngine {
  state: WorldState;
  pending: CriticalReason[] = [];
  pendingEvents: SimulationEvent[] = [];
  constructor(world = createWorld()) {
    this.state = structuredClone(world);
  }
  get base() {
    return this.state.locations.find((l) => l.id === 'base')!;
  }
  berth(s: Ship): Point {
    return {
      x: this.base.x + ((this.state.ships.findIndex((x) => x.id === s.id) % 6) - 2.5) * 42,
      y: this.base.y + 70 + Math.floor(this.state.ships.findIndex((x) => x.id === s.id) / 6) * 30,
    };
  }
  random = () => {
    this.state.seed = (Math.imul(1664525, this.state.seed) + 1013904223) >>> 0;
    return this.state.seed / 4294967296;
  };
  log(text: string, level: LogEntry['level'] = 'info') {
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
    if (w.communications.length > 100) w.communications.shift();
    this.log(text, priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'info');
  }
  critical(kind: CriticalReason['kind'], entityId: string, message: string) {
    if (!this.pending.some((r) => r.kind === kind && r.entityId === entityId))
      this.pending.push({ kind, entityId, message, tick: this.state.tick, time: this.state.time });
  }
  finishCritical(): SimulationEvent[] {
    if (!this.pending.length) return [];
    const reasons = this.pending;
    this.pending = [];
    this.state.paused = true;
    this.state.pauseReasons.push(
      ...reasons.filter(
        (r) => !this.state.pauseReasons.some((x) => x.entityId === r.entityId && x.kind === r.kind),
      ),
    );
    return [{ type: 'criticalPause', reasons: structuredClone(reasons) }];
  }
  isCommandLost(): boolean {
    return this.state.status === 'commandLost';
  }
  clearInputs() {
    /* LV1 Admiral commands have no held keys or frame input. */
  }
  snapshot = projection.snapshot.bind(this);
  getObservation = projection.getObservation.bind(this);
  controllerPort(operatorId: string): AgentControllerPort {
    return Object.freeze({
      getObservation: () => this.getObservation(operatorId),
      dispatchCommand: (c: Command) => this.dispatchCommand(c, operatorId),
      submitIntent: (intent: ControllerIntent) => this.submitIntent(operatorId, intent),
    });
  }
  validateSpec = command_system.validateSpec.bind(this);
  validate = command_system.validate.bind(this);
  dispatchCommand = command_system.dispatchCommand.bind(this);
  routeTarget = order_system.routeTarget.bind(this);
  setRoute = order_system.setRoute.bind(this);
  returnHome = order_system.returnHome.bind(this);
  releaseReservation = order_system.releaseReservation.bind(this);
  settle = order_system.settle.bind(this);
  beginInvestigation = order_system.beginInvestigation.bind(this);
  dock = order_system.dock.bind(this);
  onDetection = (i: IntelRecord, fresh: boolean, hostility: boolean) => {
    if (fresh) {
      this.report('发现未识别亚空间接触', i.id, 'high', 'threat');
      this.critical('contactDetected', i.id, '发现新接触，请评估行动');
    }
    if (hostility) {
      this.report('传感器确认敌对接触', i.id, 'urgent', 'threat');
      this.critical('hostility', i.id, '接触已确认敌对');
    }
  };
  hit = (target: Ship | Location, amount: number, attacker: Ship) =>
    applyDamage(this, target, amount, attacker);
  fired = (attacker: Ship, target: Ship | Location, weapon: WeaponDefinition, _hit: boolean) => {
    const w = this.state;
    if (attacker.factionId !== 'starfleet') {
      const result = observe(w, attacker as Enemy, 3);
      const newly = result.hostility || !result.record.hostile;
      result.record.hostile = true;
      result.record.lastAttackTargetId = target.id;
      result.record.lastAttackAt = w.time;
      this.onDetection(result.record, result.fresh, newly);
    }
    // Shots involving our ships/colonies are observable. Enemy-v-enemy combat is not simulated.
    w.beams.push({
      from: { x: attacker.x, y: attacker.y },
      to: { x: target.x, y: target.y },
      enemy: attacker.factionId !== 'starfleet',
      weapon: weapon.name,
      expires: w.time + 0.5,
    });
  };
  fire = execution.fire.bind(this);
  advanceShip = execution.advanceShip.bind(this);
  advanceOrder = order_system.advanceOrder.bind(this);
  advanceEnemy = execution.advanceEnemy.bind(this);
  withdraw = order_system.withdraw.bind(this);
  submitIntent = command_system.submitIntent.bind(this);
  step(fixedDelta = FIXED_DELTA): SimulationEvent[] {
    if (fixedDelta !== FIXED_DELTA)
      throw new Error('Simulation requires fixed 0.1 game-minute steps');
    const w = this.state;
    if (w.paused || this.isCommandLost()) return [];
    w.tick++;
    w.time = w.tick / 10;
    const events: SimulationEvent[] =
      w.tick % TICKS_PER_DAY === 0
        ? [{ type: 'dayBoundary', day: gameCalendar(w.tick).day, tick: w.tick, time: w.time }]
        : [];
    w.beams = w.beams.filter((b) => b.expires > w.time);
    if (w.tick % 10 === 0) updateSensors(w, this.random, this.onDetection);
    advanceLogistics(this, fixedDelta);
    if (w.time >= w.nextIncursion) {
      w.nextIncursion += RULES.incursionMinutes;
      if (w.enemies.filter((e) => e.hull > 0).length < RULES.maxEnemies) {
        const pirate = this.random() < 0.6;
        const classId = pirate ? 'raider' : this.random() < 0.6 ? 'scout' : 'valdore';
        w.enemies.push(
          makeEnemy(
            'enemy-' + w.nextEnemy++,
            classId,
            pirate ? 'pirate' : 'romulan',
            pirate ? RULES.pirateEntry : RULES.romulanEntry,
          ),
        );
      }
    }
    for (const s of [...w.ships]) {
      if (w.status === 'commandLost') break;
      this.advanceShip(s, fixedDelta);
    }
    for (const e of [...w.enemies]) {
      if (w.status === 'commandLost') break;
      this.advanceEnemy(e, fixedDelta);
    }
    for (const o of w.orders) {
      if (w.status === 'commandLost') break;
      this.advanceOrder(o, fixedDelta);
    }
    // Keep resolved intel for order evidence; expire map visibility independently.
    w.enemies = w.enemies.filter((e) => e.hull > 0 && !e.departed);

    return [...events, ...this.pendingEvents.splice(0), ...this.finishCritical()];
  }
  advanceFrame(
    afterStep?: (events: SimulationEvent[], state: WorldState) => void,
  ): SimulationEvent[] {
    const events: SimulationEvent[] = [],
      speed = this.state.speed;
    for (let i = 0; i < speed && !this.state.paused; i++) {
      const next = this.step();
      afterStep?.(next, this.state);
      events.push(...next);
    }
    return events;
  }
}
