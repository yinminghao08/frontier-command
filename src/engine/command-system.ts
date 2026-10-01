import { permittedTarget } from './combat';
import { commandSchema, intentSchema, orderSpecSchema } from './commands';
import { RULES } from './definitions/rules';
import { SHIP_CLASSES } from './definitions/ships';
import type { SimulationEngine } from './engine';
import { authorized, dist, objectivePosition } from './navigation';
import type { Command, CommandResult, ControllerIntent, OperationOrder, OrderSpec } from './types';

const ok = (reason = '命令已执行'): CommandResult => ({ ok: true, reason });
const no = (reason: string): CommandResult => ({ ok: false, reason });
export function validateSpec(
  this: SimulationEngine,
  spec: OrderSpec,
  existing?: OperationOrder,
): CommandResult {
  const w = this.state,
    p = objectivePosition(w, spec.objective);
  if (!p) return no('目标不存在或情报已过期');
  if (!authorized(p, spec.border)) return no('目标超出本命令的跨境授权');
  if (spec.kind !== 'defense' && spec.shipIds.length !== 1)
    return no('运输和探索须指定一艘执行舰；护航请建立防御命令');
  for (const id of spec.shipIds) {
    const s = w.ships.find((s) => s.id === id);
    if (!s) return no('舰船不存在');
    if (existing && s.orderId === existing.id) {
      if (s.status === 'returning') return no('失能或返航舰船不能重新分配');
      if (!authorized(s, spec.border)) return no('舰船仍在授权范围以外，请先撤回');
    } else if (s.status !== 'docked' || s.orderId) return no('舰船必须空闲停靠基地');
    if (!w.assignments.some((a) => a.shipId === s.id)) return no('舰船尚未分配规则操作者');
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
      src.hull <= 0 ||
      dest.hull <= 0 ||
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
    if (l.hull <= 0) return no('设施已摧毁');
    if (l.regionId !== 'federation' || !['colony', 'outpost', 'base', 'mine'].includes(l.kind))
      return no('请选择联邦防御设施');
  }
  return ok();
}
export function validate(
  this: SimulationEngine,
  command: unknown,
  actorId = 'commander',
): CommandResult {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return no('命令格式无效或数值越界');
  const c = parsed.data as Command,
    w = this.state;
  if (w.status === 'commandLost') return no('COMMAND LOST：只能恢复昨日或开始新边疆');
  if (actorId !== w.commander.id) {
    const op = w.operators.find((o) => o.id === actorId);
    if (
      !op ||
      !['scan', 'recall', 'repair', 'rearm'].includes(c.type) ||
      !('shipId' in c) ||
      !w.assignments.some((a) => a.operatorId === op.id && a.shipId === c.shipId)
    )
      return no('该操作者没有此命令权限');
  }
  if (c.type === 'assignOperator') {
    const op = w.operators.find((o) => o.id === c.operatorId),
      current = w.assignments.find((a) => a.operatorId === c.operatorId);
    const ship = c.shipId ? w.ships.find((s) => s.id === c.shipId) : null;
    if (!op || op.availability !== 'available') return no('操作者不可用');
    if (current && w.ships.find((s) => s.id === current.shipId)?.status !== 'docked')
      return no('调任需要当前舰船停靠');
    if (
      c.shipId &&
      (!ship ||
        ship.status !== 'docked' ||
        w.assignments.some((a) => a.shipId === c.shipId && a.operatorId !== op.id))
    )
      return no('目标舰船未停靠或已有操作者');
    return ok();
  }
  if (c.type === 'repairFacility') {
    const l = w.locations.find((l) => l.id === c.locationId);
    return l &&
      l.regionId === 'federation' &&
      l.hull > 0 &&
      l.hull < l.maxHull &&
      l.stock.materials - l.reserved.materials >= 1
      ? ok()
      : no('设施不可维修或本地材料不足');
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
      if (
        c.type === 'repair' &&
        this.base.stock.materials - this.base.reserved.materials <
          Math.ceil((d.hull - s.hull) / RULES.repairPerMaterial)
      )
        return no('维修材料不足');
      if (c.type === 'rearm') {
        if (c.load.photon + c.load.quantum === 0) return no('请选择装弹数量');
        for (const k of ['photon', 'quantum'] as const)
          if (c.load[k] > d[k] - s[k] || c.load[k] > w.armory.stock[k] - w.armory.reserved[k])
            return no('弹药库存或弹舱余量不足');
      }
      if (c.type === 'repair' && s.hull >= d.hull) return no('舰船无需维修');
      if (c.type === 'rearm' && s.photon >= d.photon && s.quantum >= d.quantum)
        return no('弹药已满或未装备鱼雷');
    }
    if (c.type === 'recall' && (!s.orderId || s.status === 'returning'))
      return no('没有可撤回的行动');
    if (
      c.type === 'scan' &&
      (s.status === 'repairing' || s.status === 'rearming' || s.core < 12 || s.scanUntil > w.time)
    )
      return no('扫描需要12能源、可用舰船且不能重复开启');
    return ok();
  }
  return no('未知命令');
}
export function dispatchCommand(
  this: SimulationEngine,
  command: unknown,
  actorId = 'commander',
): CommandResult {
  const valid = this.validate(command, actorId);
  if (!valid.ok) return valid;
  const c = command as Command,
    w = this.state;
  if (c.type === 'assignOperator') {
    w.assignments = w.assignments.filter((a) => a.operatorId !== c.operatorId);
    if (c.shipId) w.assignments.push({ operatorId: c.operatorId, shipId: c.shipId, since: w.tick });
    return ok('规则操作者分配已更新');
  }
  if (c.type === 'repairFacility') {
    const l = w.locations.find((l) => l.id === c.locationId)!;
    const n = Math.min(
      Math.ceil((l.maxHull - l.hull) / RULES.repairPerMaterial),
      Math.floor(l.stock.materials - l.reserved.materials),
    );
    l.stock.materials -= n;
    l.hull = Math.min(l.maxHull, l.hull + n * RULES.repairPerMaterial);
    return ok('消耗 ' + n + ' 材料完成设施维修');
  }
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
      const d = SHIP_CLASSES[s.classId],
        cost = Math.ceil((d.hull - s.hull) / RULES.repairPerMaterial);
      this.base.stock.materials -= cost;
      s.status = 'repairing';
      s.service = (d.hull - s.hull) / RULES.repairRate;
    }
    if (c.type === 'rearm') {
      s.rearm = structuredClone(c.load);
      s.status = 'rearming';
      s.service = RULES.torpedoLoadMinutes;
      for (const k of ['photon', 'quantum'] as const) w.armory.reserved[k] += c.load[k];
    }
  }
  this.finishCritical();
  return ok();
}
export function submitIntent(
  this: SimulationEngine,
  operatorId: string,
  input: ControllerIntent,
): CommandResult {
  const parsed = intentSchema.safeParse(input);
  if (!parsed.success) return no('行为格式无效');
  const a = this.state.assignments.find((a) => a.operatorId === operatorId),
    s = this.state.ships.find((s) => s.id === a?.shipId);
  if (!s || this.state.status !== 'active') return no('执行主体不可用');
  const o = this.state.orders.find((o) => o.id === s.orderId && !o.settled);
  if (!o || s.status !== 'mission') return no('没有可执行的授权行动');
  const intent = parsed.data;
  if (o.held && intent.type !== 'hold' && intent.type !== 'retreat') return no('行动暂停中');
  if (intent.type === 'engage') {
    const enemy = this.state.enemies.find((e) => e.id === intent.contactId);
    if (!enemy || !permittedTarget(this.state, s, o, enemy)) return no('接触不满足交战授权');
    s.targetId = intent.contactId;
    s.behavior = 'engage';
  } else {
    if (
      (intent.type === 'defend' && o.kind !== 'defense') ||
      (intent.type === 'transport' && o.kind !== 'transport') ||
      (intent.type === 'scan' && o.kind !== 'explore')
    )
      return no('行为不符合授权任务');
    s.targetId = null;
    s.behavior = intent.type === 'transport' ? 'travel' : intent.type;
    if (intent.type === 'retreat') this.withdraw(s, o, '规则控制器请求撤退');
  }
  return ok();
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
