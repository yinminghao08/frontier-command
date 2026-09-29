import { createWorld, makeEnemy } from './data';
import { FIXED_DELTA, TICKS_PER_DAY, gameCalendar } from './clock';
import { commandSchema, orderSpecSchema } from './commands';
import { SHIP_CLASSES, type WeaponDefinition } from './definitions/ships';
import { RULES } from './definitions/rules';
import { boundary, dist, move, objectivePosition, planRoute } from './navigation';
import { RESOURCE_DEFINITIONS } from './definitions/resources';
import { observe, updateSensors, visibleIntel } from './sensors';
import { attack, permittedTarget, regenerate, shouldRetreat } from './combat';
import { decideThreat } from './threats';
import type {
  AgentControllerPort,
  Command,
  CommandResult,
  CriticalReason,
  Enemy,
  IntelRecord,
  Location,
  LogEntry,
  Observation,
  OperationOrder,
  OrderSpec,
  Point,
  Ship,
  SimulationEvent,
  Snapshot,
  WorldState,
} from './types';
export { FIXED_DELTA } from './clock';
export { dist } from './navigation';
const ok = (reason = '命令已执行'): CommandResult => ({ ok: true, reason });
const no = (reason: string): CommandResult => ({ ok: false, reason });
export class SimulationEngine {
  state: WorldState;
  private pending: CriticalReason[] = [];
  constructor(world = createWorld()) {
    this.state = structuredClone(world);
  }
  private get base() {
    return this.state.locations.find((l) => l.id === 'base')!;
  }
  private berth(s: Ship): Point {
    return {
      x: this.base.x + (this.state.ships.findIndex((x) => x.id === s.id) - 1.5) * 70,
      y: this.base.y + 90,
    };
  }
  private random = () => {
    this.state.seed = (Math.imul(1664525, this.state.seed) + 1013904223) >>> 0;
    return this.state.seed / 4294967296;
  };
  log(text: string, level: LogEntry['level'] = 'info') {
    const w = this.state;
    w.logs.push({ id: w.nextLog++, time: w.time, text, level });
    if (w.logs.length > 180) w.logs.shift();
  }
  private report(
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
  private critical(kind: CriticalReason['kind'], entityId: string, message: string) {
    if (!this.pending.some((r) => r.kind === kind && r.entityId === entityId))
      this.pending.push({ kind, entityId, message, tick: this.state.tick, time: this.state.time });
  }
  private finishCritical(): SimulationEvent[] {
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
  clearInputs() {
    /* LV1 Admiral commands have no held keys or frame input. */
  }
  snapshot(): Snapshot {
    const w = this.state;
    return structuredClone({
      version: w.version,
      tick: w.tick,
      time: w.time,
      paused: w.paused,
      speed: w.speed,
      pauseReasons: w.pauseReasons,
      commander: w.commander,
      operators: w.operators,
      ships: w.ships,
      contacts: visibleIntel(w),
      orders: w.orders,
      locations: w.locations.map((l) =>
        l.regionId === 'romulan'
          ? {
              ...l,
              stock: { supplies: 0, medical: 0, materials: 0 },
              reserved: { supplies: 0, medical: 0, materials: 0 },
              hull: 0,
              maxHull: 0,
              distress: false,
            }
          : l,
      ),
      resources: w.resources,
      communications: w.communications,
      logs: w.logs,
      beams: w.beams,
      explored: w.explored,
    });
  }
  getObservation(operatorId: string): Observation | null {
    const operator = this.state.operators.find((o) => o.id === operatorId),
      ship = this.state.ships.find((s) => s.id === operator?.shipId);
    if (!ship) return null;
    return structuredClone({
      time: this.state.time,
      operatorId,
      ship,
      contacts: visibleIntel(this.state),
      orders: this.state.orders.filter((o) => o.shipIds.includes(ship.id)),
      legalActions: ['scan', 'recall', 'repair', 'rearm'].filter(
        (type) => this.validate({ type, shipId: ship.id }, operatorId).ok,
      ),
    });
  }
  controllerPort(operatorId: string): AgentControllerPort {
    return Object.freeze({
      getObservation: () => this.getObservation(operatorId),
      dispatchCommand: (c: Command) => this.dispatchCommand(c, operatorId),
    });
  }
  private validateSpec(spec: OrderSpec, existing?: OperationOrder): CommandResult {
    const w = this.state,
      p = objectivePosition(w, spec.objective);
    if (!p) return no('目标不存在或情报已过期');
    if (p.x > boundary(spec.border)) return no('目标超出本命令的跨境授权');
    if (spec.kind !== 'defense' && spec.shipIds.length !== 1)
      return no('运输和探索须指定一艘执行舰；护航请建立防御命令');
    for (const id of spec.shipIds) {
      const s = w.ships.find((s) => s.id === id);
      if (!s) return no('舰船不存在');
      if (existing && s.orderId === existing.id) {
        if (s.status === 'disabled' || s.status === 'returning')
          return no('失能或返航舰船不能重新分配');
        if (s.x > boundary(spec.border)) return no('舰船仍在授权范围以外，请先撤回');
      } else if (s.status !== 'docked' || s.orderId) return no('舰船必须空闲停靠基地');
      if (s.hull / SHIP_CLASSES[s.classId].hull < 0.35) return no('舰体低于35%，请先维修');
    }
    if (spec.objective.type === 'ship' && spec.shipIds.includes(spec.objective.id))
      return no('不能指派舰船保护自己');
    if (spec.kind === 'transport') {
      const src = w.locations.find((l) => l.id === spec.sourceId);
      const dest =
        spec.objective.type === 'location'
          ? w.locations.find((l) => l.id === spec.objective.id)
          : null;
      if (
        !src ||
        !dest ||
        src.id === dest.id ||
        !['base', 'colony', 'outpost', 'mine'].includes(src.kind) ||
        !['base', 'colony', 'outpost', 'mine'].includes(dest.kind) ||
        src.regionId !== 'federation' ||
        dest.regionId !== 'federation'
      )
        return no('请选择不同的联邦物流起终点');
      if (spec.amount > SHIP_CLASSES[w.ships.find((s) => s.id === spec.shipIds[0])!.classId].cargo)
        return no('货舱容量不足');
      if (!existing && src.stock[spec.cargoKind] - src.reserved[spec.cargoKind] < spec.amount)
        return no('起点可用库存不足');
    }
    if (spec.kind === 'explore') {
      if (spec.objective.type === 'ship') return no('探索目标应为地点、未知区域或敌方接触');
      if (SHIP_CLASSES[w.ships.find((s) => s.id === spec.shipIds[0])!.classId].science < 40)
        return no('科学能力不足40，建议 Constitution');
    }
    if (spec.kind === 'defense' && spec.objective.type === 'point')
      return no('防御需要殖民地、舰船或敌方接触目标');
    if (spec.kind === 'defense' && spec.objective.type === 'location') {
      const l = w.locations.find((l) => l.id === spec.objective.id)!;
      if (l.regionId !== 'federation' || !['colony', 'outpost', 'base', 'mine'].includes(l.kind))
        return no('请选择联邦防御设施');
    }
    return ok();
  }
  validate(command: unknown, actorId = 'commander'): CommandResult {
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) return no('命令格式无效或数值越界');
    const c = parsed.data as Command,
      w = this.state;
    if (actorId !== w.commander.id) {
      const op = w.operators.find((o) => o.id === actorId);
      if (!op || !('shipId' in c) || op.shipId !== c.shipId) return no('该操作者没有此命令权限');
    }
    if (c.type === 'pause' || c.type === 'speed') return ok();
    if (c.type === 'acknowledge')
      return w.communications.some((m) => m.id === c.communicationId) ? ok() : no('通信已过期');
    if (c.type === 'createOrder') return this.validateSpec(c.spec);
    if ('orderId' in c) {
      const o = w.orders.find((o) => o.id === c.orderId);
      if (!o || o.settled) return no('行动不存在或已经结算');
      if (c.type === 'updateOrder') {
        if ((c.changes.objective || c.changes.shipIds) && o.kind !== 'defense')
          return no('运输和探索在执行中不能更换目标或舰船');
        if (c.changes.approach && o.kind === 'explore' && o.phase === 'working')
          return no('调查已执行，不能重置采样方案');
        const spec = { ...o, ...c.changes };
        if (!orderSpecSchema.safeParse(specOnly(spec)).success) return no('行动参数无效');
        return this.validateSpec(spec, o);
      }
      if (c.type === 'investigate' && (o.kind !== 'explore' || o.phase !== 'decision'))
        return no('当前没有待决调查');
      if (c.type === 'holdOrder' && o.held) return no('行动已暂停');
      if (c.type === 'resumeOrder' && !o.held) return no('行动没有暂停');
      return ok();
    }
    if ('shipId' in c) {
      const s = w.ships.find((s) => s.id === c.shipId);
      if (!s) return no('舰船不存在');
      if (c.type === 'repair' || c.type === 'rearm') {
        if (s.status !== 'docked' || s.orderId) return no('必须空闲停靠基地');
        const d = SHIP_CLASSES[s.classId];
        if (c.type === 'repair' && s.hull >= d.hull && s.shield >= d.shield)
          return no('舰船无需维修');
        if (c.type === 'rearm' && s.photon >= d.photon && s.quantum >= d.quantum)
          return no('弹药已满或未装备鱼雷');
      }
      if (
        c.type === 'recall' &&
        (!s.orderId || s.status === 'returning' || s.status === 'disabled')
      )
        return no('没有可撤回的行动');
      if (
        c.type === 'scan' &&
        (s.status === 'disabled' ||
          s.status === 'repairing' ||
          s.status === 'rearming' ||
          s.core < 12 ||
          s.scanUntil > w.time)
      )
        return no('扫描需要12能源、可用舰船且不能重复开启');
      return ok();
    }
    return no('未知命令');
  }
  dispatchCommand(command: unknown, actorId = 'commander'): CommandResult {
    const valid = this.validate(command, actorId);
    if (!valid.ok) return valid;
    const c = command as Command,
      w = this.state;
    if (c.type === 'pause') {
      w.paused = c.paused;
      if (!c.paused) w.pauseReasons = [];
      return ok(c.paused ? '模拟已暂停' : '模拟继续');
    }
    if (c.type === 'speed') {
      w.speed = c.speed;
      return ok('时间倍率已更新');
    }
    if (c.type === 'acknowledge') {
      w.communications.find((m) => m.id === c.communicationId)!.read = true;
      return ok('通信已确认');
    }
    if (c.type === 'createOrder') {
      const spec = structuredClone(c.spec),
        p = objectivePosition(w, spec.objective)!;
      const slowest = Math.min(
        ...spec.shipIds.map((id) => SHIP_CLASSES[w.ships.find((s) => s.id === id)!.classId].warp),
      );
      const o: OperationOrder = {
        ...spec,
        id: 'order-' + w.nextOrder++,
        created: w.time,
        phase: 'preparing',
        work: 0,
        decisionAt: 0,
        settled: false,
        outcome: null,
        result: '',
        held: false,
        loaded: false,
        delivered: false,
        reserved: 0,
        deadline: w.time + (dist(this.base, p) / slowest) * 2 + spec.duration + 180,
        targetLastSeen: { x: p.x, y: p.y },
        searchUntil: 0,
        rewarded: false,
      };
      if (o.kind === 'transport') {
        const src = w.locations.find((l) => l.id === o.sourceId)!;
        src.reserved[o.cargoKind] += o.amount;
        o.reserved = o.amount;
        o.deadline = w.time + ((dist(this.base, src) + dist(src, p)) / slowest) * 1.6 + 100;
      }
      w.orders.push(o);
      for (const s of w.ships.filter((s) => o.shipIds.includes(s.id))) {
        s.orderId = o.id;
        s.status = 'mission';
        s.behavior = 'travel';
        this.setRoute(s, o);
      }
      this.report(
        o.id +
          ' 已接受：' +
          { defense: '防御／拦截', transport: '运输', explore: '探索／侦察' }[o.kind],
        o.id,
        o.priority,
      );
      return ok('行动已接受，启动时间后执行');
    }
    if ('orderId' in c) {
      const o = w.orders.find((o) => o.id === c.orderId)!;
      if (c.type === 'cancelOrder') this.settle(o, 'cancelled', '指挥官取消，执行返航');
      if (c.type === 'holdOrder') {
        o.held = true;
        for (const s of w.ships.filter((s) => s.orderId === o.id)) s.behavior = 'hold';
      }
      if (c.type === 'resumeOrder') o.held = false;
      if (c.type === 'investigate') this.beginInvestigation(o, c.approach);
      if (c.type === 'updateOrder') {
        const oldShips = [...o.shipIds];
        Object.assign(o, structuredClone(c.changes));
        for (const id of oldShips.filter((id) => !o.shipIds.includes(id))) {
          const s = w.ships.find((s) => s.id === id)!;
          this.returnHome(s);
        }
        for (const s of w.ships.filter((s) => o.shipIds.includes(s.id))) {
          s.orderId = o.id;
          s.status = 'mission';
          this.setRoute(s, o);
        }
        if (c.changes.objective) {
          o.phase = 'outbound';
          o.work = 0;
          o.searchUntil = 0;
          o.targetLastSeen = objectivePosition(w, o.objective);
          o.deadline = Math.max(o.deadline, w.time + o.duration + 180);
        }
        this.report(o.id + ' 指令已更新', o.id, o.priority);
      }
    }
    if ('shipId' in c) {
      const s = w.ships.find((s) => s.id === c.shipId)!;
      if (c.type === 'scan') {
        s.core -= 12;
        s.scanUntil = w.time + 12;
        s.behavior = 'scan';
      }
      if (c.type === 'recall') {
        const o = w.orders.find((o) => o.id === s.orderId)!;
        this.settle(o, 'cancelled', '指挥官撤退，未交付货物回收');
      }
      if (c.type === 'repair') {
        const cost = 10,
          available = this.base.stock.materials - this.base.reserved.materials;
        s.status = 'repairing';
        s.service = available >= cost ? RULES.serviceMinutes : RULES.serviceMinutes * 3;
        if (available >= cost) this.base.stock.materials -= cost;
      }
      if (c.type === 'rearm') {
        const available = this.base.stock.materials - this.base.reserved.materials;
        s.status = 'rearming';
        s.service = available >= 5 ? RULES.serviceMinutes : RULES.serviceMinutes * 3;
        if (available >= 5) this.base.stock.materials -= 5;
      }
    }
    this.finishCritical();
    return ok();
  }
  private routeTarget(o: OperationOrder): Point | null {
    if (o.kind === 'transport' && !o.loaded)
      return this.state.locations.find((l) => l.id === o.sourceId)!;
    const p = objectivePosition(this.state, o.objective);
    if (!p) return o.targetLastSeen;
    o.targetLastSeen = { x: p.x, y: p.y };
    if (o.kind === 'explore' && o.approach === 'remote') {
      return { x: Math.max(20, p.x - 65), y: p.y };
    }
    return p;
  }
  private setRoute(s: Ship, o: OperationOrder) {
    const p = this.routeTarget(o);
    s.path = p ? planRoute(this.state, s, p, o.route === 'safe', o.border) : [];
  }
  private returnHome(s: Ship) {
    if (s.status === 'disabled') return;
    s.status = 'returning';
    s.behavior = 'retreat';
    s.targetId = null;
    s.path = planRoute(this.state, s, this.berth(s), true, 'romulan');
  }
  private releaseReservation(o: OperationOrder) {
    if (o.reserved) {
      const src = this.state.locations.find((l) => l.id === o.sourceId)!;
      src.reserved[o.cargoKind] -= o.reserved;
      o.reserved = 0;
    }
  }
  private settle(o: OperationOrder, outcome: OperationOrder['outcome'], reason: string) {
    if (o.settled) return;
    o.settled = true;
    o.outcome = outcome;
    o.phase = 'returning';
    o.held = false;
    this.releaseReservation(o);
    const w = this.state;
    if (outcome === 'success') {
      if (o.kind === 'defense') {
        w.resources.allocation += 45;
        w.resources.intel += 8;
        reason += '；防卫配额 +45，情报 +8';
      }
      if (o.kind === 'transport') {
        w.resources.allocation += 20;
        reason += '；运输配额 +20';
      }
      if (o.kind === 'explore') {
        const loc =
          o.objective.type === 'location' ? w.locations.find((l) => l.id === o.objective.id) : null;
        const p = o.targetLastSeen!;
        const already = loc
          ? loc.rewardedRevision >= loc.surveyRevision
          : w.explored.some((x) => dist(x, p) < 60);
        if (!already) {
          const s = w.ships.find((s) => s.id === o.shipIds[0])!,
            science = Math.round(
              SHIP_CLASSES[s.classId].science * 0.4 * (o.approach === 'close' ? 1.6 : 1),
            );
          w.resources.science += science;
          w.resources.intel += o.approach === 'close' ? 12 : 5;
          w.explored.push({ ...p, time: w.time });
          o.rewarded = true;
          if (loc) {
            loc.surveyed = true;
            loc.rewardedRevision = loc.surveyRevision;
          }
          reason += '；科研 +' + science + '，新增调查情报';
        } else reason += '；记录已更新，本区域没有新的科研奖励';
      }
    } else if (outcome === 'failed') {
      this.critical('missionFailed', o.id, reason);
    }
    o.result = reason;
    this.report(
      o.id +
        ' ' +
        (outcome === 'success' ? '成功' : outcome === 'failed' ? '失败' : '取消') +
        '：' +
        reason,
      o.id,
      outcome === 'failed' ? 'urgent' : o.priority,
    );
    for (const s of w.ships.filter((s) => s.orderId === o.id)) this.returnHome(s);
  }
  private beginInvestigation(o: OperationOrder, approach: 'remote' | 'close') {
    o.approach = approach;
    o.phase = 'working';
    o.work = 0;
    for (const s of this.state.ships.filter((s) => s.orderId === o.id)) {
      s.behavior = 'scan';
      this.setRoute(s, o);
    }
    this.report(
      o.id +
        ' 采用' +
        (approach === 'close' ? '近距采样，承担暴露与辐射风险' : '远距扫描，保留安全距离'),
      o.id,
      o.priority,
    );
  }
  private dock(s: Ship) {
    for (const k of ['supplies', 'medical', 'materials'] as const) {
      this.base.stock[k] += s.cargo[k];
      s.cargo[k] = 0;
    }
    s.status = 'docked';
    s.orderId = null;
    s.targetId = null;
    s.path = [];
    s.behavior = 'hold';
    this.report(s.name + ' 已返航，可安排维修、装弹或再次派遣', s.id);
  }
  private onDetection = (i: IntelRecord, fresh: boolean, hostility: boolean) => {
    if (fresh) {
      this.report('发现未识别亚空间接触', i.id, 'high', 'threat');
      this.critical('contactDetected', i.id, '发现新接触，请评估行动');
    }
    if (hostility) {
      this.report('传感器确认敌对接触', i.id, 'urgent', 'threat');
      this.critical('hostility', i.id, '接触已确认敌对');
    }
  };
  private hit = (target: Ship | Location, amount: number, attacker: Ship) => {
    const w = this.state,
      previous = target.hull;
    if ('shield' in target) {
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      target.hull = Math.max(0, target.hull - amount + absorbed);
      target.lastAttackerId = attacker.id;
      target.attackedAt = w.time;
      if (target.factionId === 'starfleet') {
        if (
          attacker.factionId === 'pirate' &&
          target.hull < SHIP_CLASSES[target.classId].hull * 0.5
        ) {
          const raider = w.enemies.find((e) => e.id === attacker.id);
          if (raider)
            for (const kind of ['supplies', 'medical', 'materials'] as const) {
              const stolen = Math.min(target.cargo[kind], Math.max(0, 20 - raider.loot));
              target.cargo[kind] -= stolen;
              raider.cargo[kind] += stolen;
              raider.loot += stolen;
            }
        }
        if (
          previous >= SHIP_CLASSES[target.classId].hull * 0.3 &&
          target.hull < SHIP_CLASSES[target.classId].hull * 0.3
        )
          this.critical('lowHull', target.id, target.name + ' 舰体低于30%');
        if (target.hull <= 0 && target.status !== 'disabled') {
          target.status = 'disabled';
          target.service = RULES.towMinutes;
          target.path = [];
          target.behavior = 'hold';
          const o = w.orders.find((o) => o.id === target.orderId);
          if (o && !o.settled) this.settle(o, 'failed', '舰船失能，启动应急拖航');
          this.critical('disabled', target.id, target.name + ' 失能，等待拖航');
        }
      } else if (target.hull <= 0) {
        const intel = w.intel.find((i) => i.id === target.id && i.live);
        if (intel) {
          intel.resolved = true;
          intel.resolution = 'destroyed';
          this.report('已确认目标失能／击毁', target.id, 'high');
        }
      }
      if (target.factionId !== 'starfleet') {
        const intel = w.intel.find((i) => i.id === target.id && i.live && i.classId);
        if (intel) {
          intel.hull = target.hull;
          intel.shield = target.shield;
        }
      }
    } else {
      if (target.kind === 'base') return;
      target.hull = Math.max(0, target.hull - amount);
      if (!target.distress) {
        target.distress = true;
        this.report(target.name + ' 遭袭，请求防御支援', target.id, 'urgent', 'request');
        this.critical('hostility', target.id, '殖民地遭到攻击');
      }
      const e = w.enemies.find((e) => e.id === attacker.id);
      if (e && e.factionId === 'pirate') {
        const stolen = Math.min(2, Math.max(0, target.stock.supplies - target.reserved.supplies));
        target.stock.supplies -= stolen;
        e.loot += stolen;
      }
    }
  };
  private fired = (
    attacker: Ship,
    target: Ship | Location,
    weapon: WeaponDefinition,
    _hit: boolean,
  ) => {
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
  private fire(s: Ship, t: Ship | Location) {
    attack(this.state, s, t, { random: this.random, hit: this.hit, fired: this.fired });
  }
  private advanceShip(s: Ship, dt: number) {
    const w = this.state,
      d = SHIP_CLASSES[s.classId];
    if (s.status === 'disabled') {
      s.service -= dt;
      if (s.service <= 0) {
        Object.assign(s, this.berth(s));
        s.hull = 1;
        this.dock(s);
      }
      return;
    }
    regenerate(s, w.time, dt);
    if (s.status === 'repairing' || s.status === 'rearming') {
      s.service -= dt;
      if (s.service <= 0) {
        if (s.status === 'repairing') {
          s.hull = d.hull;
          s.shield = d.shield;
        } else {
          s.photon = d.photon;
          s.quantum = d.quantum;
        }
        s.status = 'docked';
        this.report(s.name + ' 基地保障完成', s.id);
      }
      return;
    }
    if (s.status === 'docked') return;
    const o = w.orders.find((o) => o.id === s.orderId);
    if (!o) {
      this.returnHome(s);
    }
    if (o && !o.settled && shouldRetreat(s, o)) this.settle(o, 'failed', '达到撤退条件，保全舰船');
    if (s.status === 'returning') {
      if (s.path.length && move(s, s.path[0], dt, 'romulan')) s.path.shift();
      if (dist(s, this.berth(s)) < 3) this.dock(s);
      return;
    }
    if (!o || o.held) return;
    const p = this.routeTarget(o);
    if (w.tick % 30 === 0 && (o.objective.type === 'ship' || o.objective.type === 'contact'))
      this.setRoute(s, o);
    if (w.tick % 50 === 0 && o.route === 'safe' && s.path.length) this.setRoute(s, o);
    const candidates = w.enemies
      .filter((e) => permittedTarget(w, s, o, e))
      .filter((e) => {
        if (o.kind !== 'defense') return dist(s, e) <= 110;
        return p && dist(e, p) <= 260;
      })
      .sort((a, b) => {
        const priority = (e: Enemy) => {
          const intel = w.intel.find((i) => i.id === e.id);
          return w.orders
            .filter(
              (other) =>
                !other.settled &&
                other.objective.type !== 'point' &&
                other.objective.id === intel?.lastAttackTargetId,
            )
            .reduce(
              (v, other) =>
                Math.max(v, other.priority === 'urgent' ? 3 : other.priority === 'high' ? 2 : 1),
              0,
            );
        };
        return priority(b) - priority(a) || dist(s, a) - dist(s, b) || a.id.localeCompare(b.id);
      });
    const target = candidates[0];
    if (target) {
      s.targetId = target.id;
      s.behavior = 'engage';
      if (o.kind === 'defense' && dist(s, target) > 80) move(s, target, dt, o.border);
      this.fire(s, target);
      if (o.kind === 'defense') return;
    } else {
      s.targetId = null;
      s.behavior = o.kind === 'defense' ? 'defend' : o.kind === 'explore' ? 'scan' : 'travel';
      if (p && dist(s, p) > 12 && !s.path.length) this.setRoute(s, o);
    }
    if (s.path.length && move(s, s.path[0], dt, o.border)) s.path.shift();
  }
  private advanceOrder(o: OperationOrder, dt: number) {
    const w = this.state,
      ships = w.ships.filter((s) => o.shipIds.includes(s.id)),
      s = ships[0];
    if (o.settled) {
      if (!w.ships.some((s) => s.orderId === o.id)) {
        o.phase = 'complete';
      }
      return;
    }
    if (w.time > o.deadline) {
      this.settle(o, 'failed', '行动超时，停止搜索／交付并返航');
      return;
    }
    if (o.held) return;
    const p = this.routeTarget(o);
    if (o.objective.type === 'contact') {
      const intel = w.intel.find((i) => i.id === o.objective.id);
      if (intel?.resolved && o.kind === 'defense') {
        this.settle(o, 'success', '确认目标已被击毁或驱离');
        return;
      }
      if (!intel?.live) {
        if (!o.searchUntil) o.searchUntil = w.time + RULES.searchMinutes;
        if (w.time >= o.searchUntil) {
          this.settle(o, 'failed', '丢失接触，搜索结束；未确认驱离');
          return;
        }
      } else o.searchUntil = 0;
    }
    if (!p) {
      this.settle(o, 'failed', '目标失效');
      return;
    }
    if (o.kind === 'transport' && !o.loaded) {
      if (dist(s, p) > 5) {
        o.phase = 'preparing';
        return;
      }
      o.work += dt;
      if (o.work < RULES.loadMinutes) return;
      const src = w.locations.find((l) => l.id === o.sourceId)!;
      src.stock[o.cargoKind] -= o.amount;
      s.cargo[o.cargoKind] += o.amount;
      this.releaseReservation(o);
      o.loaded = true;
      o.work = 0;
      o.phase = 'outbound';
      this.setRoute(s, o);
      return;
    }
    if (o.phase === 'preparing') {
      o.phase = 'outbound';
    }
    if (o.phase === 'outbound' && ships.some((s) => dist(s, p) < 12)) {
      o.work = 0;
      o.phase = o.kind === 'explore' ? 'decision' : 'working';
      if (o.phase === 'decision') {
        o.decisionAt = w.time;
        this.report(o.id + ' 抵达调查区，请选择远距或近距方案', o.id, o.priority, 'decision');
        this.critical('investigation', o.id, '调查方案等待指挥官决策');
      }
    }
    if (o.phase === 'decision') {
      if (w.time - o.decisionAt >= 20) this.beginInvestigation(o, o.approach);
      return;
    }
    if (o.phase !== 'working') return;
    if (o.kind === 'transport') {
      if (dist(s, p) > 8) return;
      o.work += dt;
      if (o.work >= RULES.loadMinutes) {
        const dest = w.locations.find(
          (l) => o.objective.type === 'location' && l.id === o.objective.id,
        )!;
        const delivered = s.cargo[o.cargoKind];
        dest.stock[o.cargoKind] += delivered;
        s.cargo[o.cargoKind] = 0;
        if (o.cargoKind === 'materials')
          dest.hull = Math.min(dest.maxHull, dest.hull + delivered * 2);
        dest.distress = dest.hull < 100 || dest.stock.supplies < 20;
        o.delivered = true;
        this.settle(
          o,
          delivered >= o.amount ? 'success' : 'failed',
          '实际交付 ' +
            delivered +
            ' / ' +
            o.amount +
            ' 至' +
            dest.name +
            (delivered < o.amount ? '；货物损失，未满足运输需求' : ''),
        );
      }
    }
    if (o.kind === 'explore') {
      if (dist(s, p) > 12) return;
      if (o.objective.type === 'contact') {
        const i = w.intel.find((i) => i.id === o.objective.id);
        if (!i?.live) return;
        s.scanUntil = Math.max(s.scanUntil, w.time + 1);
        if (!['IDENTIFIED', 'TRACKED'].includes(i.level)) return;
      }
      o.work += dt;
      const l =
        o.objective.type === 'location' ? w.locations.find((l) => l.id === o.objective.id) : null;
      if (o.approach === 'close' && l?.hazard) {
        s.hull = Math.max(1, s.hull - dt * 0.5);
        if (shouldRetreat(s, o)) {
          this.settle(o, 'failed', '近距辐射触发撤退条件');
          return;
        }
      }
      if (
        o.work >=
        (RULES.surveyMinutes * (o.approach === 'close' ? 1.3 : 1) * 70) /
          SHIP_CLASSES[s.classId].science
      )
        this.settle(o, 'success', o.approach === 'close' ? '近距高精度调查完成' : '远距测绘完成');
    }
    if (o.kind === 'defense') {
      const protectedObject =
        o.objective.type === 'location'
          ? w.locations.find((l) => l.id === o.objective.id)
          : o.objective.type === 'ship'
            ? w.ships.find((s) => s.id === o.objective.id)
            : null;
      if (protectedObject && protectedObject.hull <= 0) {
        this.settle(o, 'failed', '保护目标失能');
        return;
      }
      if (o.objective.type === 'contact') return;
      if (ships.some((s) => dist(s, p) < 100)) o.work += dt;
      // Safety checks use current sensed attackers, never undiscovered enemies.
      const attacking = visibleIntel(w).some((i) => i.live && i.hostile && dist(i, p) < 180);
      if (o.work >= o.duration && !attacking) {
        if (protectedObject && 'distress' in protectedObject)
          protectedObject.distress =
            protectedObject.hull < 100 || protectedObject.stock.supplies < 20;
        this.settle(o, 'success', '保护目标存续，防御窗口完成');
      }
    }
  }
  private advanceEnemy(e: Enemy, dt: number) {
    const w = this.state;
    if (e.hull <= 0) return;
    regenerate(e, w.time, dt);
    decideThreat(w, e);
    if (e.intent === 'retreat') {
      e.behavior = 'retreat';
      move(e, e.home, dt);
      const i = w.intel.find((i) => i.id === e.id && i.live);
      if (i && dist(e, e.home) < 60) {
        i.resolved = true;
        i.resolution = 'withdrawn';
        this.report('确认敌方接触撤出行动区域', e.id, 'high');
      }
      if (dist(e, e.home) < 5) e.hull = 0;
      return;
    }
    const known = e.knownTargets.find((t) => t.id === e.targetId);
    const target =
      w.ships.find((s) => s.id === e.targetId) || w.locations.find((l) => l.id === e.targetId);
    if (known && target && target.hull > 0) {
      const sensed = dist(e, target) <= SHIP_CLASSES[e.classId].sensors || !('classId' in target);
      const p = sensed ? target : known;
      e.behavior = 'engage';
      if (dist(e, p) > 75) move(e, p, dt);
      if (sensed && dist(e, target) < 110) {
        this.fire(e, target);
      }
    } else {
      e.behavior = 'scan';
      const waypoint =
        e.factionId === 'pirate'
          ? { x: 440, y: 660 }
          : {
              x: e.classId === 'scout' ? 1090 : 1370,
              y: 250 + (Number(e.id.split('-')[1]) % 3) * 150,
            };
      if (dist(e, waypoint) > 10) move(e, waypoint, dt);
      if (
        e.factionId === 'romulan' &&
        e.cloak === 'off' &&
        e.core > SHIP_CLASSES[e.classId].core * 0.8 &&
        w.time - e.attackedAt > 20
      )
        e.cloak = 'on';
    }
  }
  step(fixedDelta = FIXED_DELTA): SimulationEvent[] {
    if (fixedDelta !== FIXED_DELTA)
      throw new Error('Simulation requires fixed 0.1 game-minute steps');
    const w = this.state;
    if (w.paused) return [];
    w.tick++;
    w.time = w.tick / 10;
    const events: SimulationEvent[] =
      w.tick % TICKS_PER_DAY === 0
        ? [{ type: 'dayBoundary', day: gameCalendar(w.tick).day, tick: w.tick, time: w.time }]
        : [];
    w.beams = w.beams.filter((b) => b.expires > w.time);
    if (w.tick % 10 === 0) updateSensors(w, this.random, this.onDetection);
    if (w.tick % (RULES.resupplyMinutes * 10) === 0) {
      const received: string[] = [];
      for (const k of ['supplies', 'medical', 'materials'] as const) {
        const definition = RESOURCE_DEFINITIONS[k];
        const amount = Math.max(
          0,
          Math.min(definition.resupplyAmount, definition.resupplyCap - this.base.stock[k]),
        );
        this.base.stock[k] += amount;
        received.push(definition.label + ' +' + amount);
      }
      this.report('Starfleet 常规补给抵达：' + received.join('，'), 'base');
      for (const l of w.locations.filter(
        (l) => l.kind === 'colony' && l.regionId === 'federation',
      )) {
        l.stock.supplies = Math.max(l.reserved.supplies, l.stock.supplies - 15);
        if (l.stock.supplies < 20 && !l.distress) {
          l.distress = true;
          this.report(l.name + ' 储备偏低，请求运输', l.id, 'high', 'request');
        }
      }
    }
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
    for (const s of w.ships) this.advanceShip(s, fixedDelta);
    for (const e of w.enemies) this.advanceEnemy(e, fixedDelta);
    for (const o of w.orders) this.advanceOrder(o, fixedDelta);
    // Keep resolved intel for order evidence; expire map visibility independently.
    w.enemies = w.enemies.filter((e) => e.hull > 0);
    if (w.orders.length > 200)
      w.orders = w.orders.filter((o) => o.phase !== 'complete' || w.time - o.created < 1440);
    return [...events, ...this.finishCritical()];
  }
  advanceFrame(): SimulationEvent[] {
    const events: SimulationEvent[] = [],
      speed = this.state.speed;
    for (let i = 0; i < speed && !this.state.paused; i++) events.push(...this.step());
    return events;
  }
}
function specOnly(o: OrderSpec): OrderSpec {
  const {
    kind,
    objective,
    shipIds,
    priority,
    roe,
    border,
    retreat,
    duration,
    sourceId,
    cargoKind,
    amount,
    route,
    approach,
  } = o;
  return {
    kind,
    objective,
    shipIds,
    priority,
    roe,
    border,
    retreat,
    duration,
    sourceId,
    cargoKind,
    amount,
    route,
    approach,
  };
}
