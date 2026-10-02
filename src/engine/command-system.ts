import type { SimulationEngine } from './engine';
import type { Action, Command, CommandResult, Cost, Directive, Ship, WorldState } from './types';
import { GOODS } from './types';
import { actionSchema, commandSchema } from './commands';
import { emptyStock } from './data';
import { capabilities, cargoUsed } from './capabilities';
import { BUILD_COSTS, FACILITIES, UPGRADES, cost } from './definitions/progression';
import { RULES } from './definitions/rules';
import { RESOURCE_DEFINITIONS } from './definitions/resources';
export const ok = (reason = '命令已接受'): CommandResult => ({ ok: true, reason });
export const no = (reason: string): CommandResult => ({ ok: false, reason });
export function inventory(w: WorldState, id: string) {
  const l = w.locations.find((l) => l.id === id && l.owner === 'starfleet' && l.hull > 0);
  if (l) return l;
  const p = w.projects.find((p) => p.id === id);
  if (!p) return undefined;
  return p.complete
    ? w.locations.find(
        (l) => l.siteId === p.siteId && l.kind === p.kind && l.owner === 'starfleet' && l.hull > 0,
      )
    : p;
}
export function available(w: WorldState, id: string, key: (typeof GOODS)[number]) {
  const holder = inventory(w, id);
  if (!holder) return 0;
  const reserved = w.ships
    .flatMap((s) => [s.current, ...s.suspended].filter((d): d is Directive => d !== null))
    .filter((d) => {
      const ref =
        'sourceId' in d.action
          ? d.action.sourceId
          : 'targetId' in d.action
            ? d.action.targetId
            : null;
      return ref !== null && inventory(w, ref)?.id === holder.id;
    })
    .reduce((a, d) => a + d.reserved[key], 0);
  return Math.max(0, holder.stock[key] - reserved);
}
export function canPay(e: SimulationEngine, c: Cost) {
  return (
    e.state.resources.credits + 1e-8 >= c.credits &&
    (['materials', 'supplies', 'specialFinds'] as const).every(
      (k) => available(e.state, 'base', k) + 1e-8 >= c[k],
    )
  );
}
export function pay(e: SimulationEngine, c: Cost) {
  e.state.resources.credits = Math.max(0, e.state.resources.credits - c.credits);
  for (const k of ['materials', 'supplies', 'specialFinds'] as const)
    e.base.stock[k] = Math.max(0, e.base.stock[k] - c[k]);
}
export function validateAction(e: SimulationEngine, s: Ship, a: Action): CommandResult {
  const w = e.state;
  if (a.type === 'MOVE') return ok();
  if (a.type === 'EXPLORE') {
    if (
      !w.sectors.some(
        (c) =>
          c.discovered &&
          Math.max(Math.abs(c.q - a.sector.q), Math.abs(c.r - a.sector.r)) <=
            (s.modules.includes('longRangeSensors') ? 2 : 1),
      )
    )
      return no('请从已知边疆继续探索；远程传感器可延伸候选范围');
    return ok();
  }
  if (a.type === 'SURVEY') {
    const b = w.bodies.find((b) => b.id === a.targetId && b.discovered),
      sys = w.systems.find((x) => x.id === a.targetId && x.discovered);
    if (!b && !sys) return no('目标尚未发现');
    if (a.deep && !s.modules.includes('deepScan')) return no('需要 Deep Scan 模块');
    return ok();
  }
  if (a.type === 'MINE') {
    const b = w.bodies.find((b) => b.id === a.targetId && b.discovered && b.kind === 'resource');
    if (!b || b.survey < 2) return no('请先近距确认矿藏');
    if (b.remaining <= 0) return no('矿藏已枯竭');
    return inventory(w, a.unloadId) ? ok() : no('卸货设施不可用');
  }
  if (a.type === 'HAUL') {
    const src = inventory(w, a.sourceId),
      dst = inventory(w, a.targetId);
    if (!src || !dst || src.id === dst.id) return no('请选择不同的己方库存或建设项目');
    if (a.amount > capabilities(s).cargo) return no('货舱容量不足，请分批或安装 Expanded Cargo');
    if (a.repeat && !w.upgrades.logistics) return no('持续货运需要 Logistics 升级');
    return ok();
  }
  if (
    a.type === 'ATTACK' ||
    a.type === 'DISABLE' ||
    a.type === 'DRIVE_OFF' ||
    a.type === 'INTERCEPT' ||
    a.type === 'SHADOW'
  ) {
    if (a.subsystem && (a.type !== 'DISABLE' || !s.modules.includes('precisionTargeting')))
      return no('定向禁用需要 Precision Targeting');
    return w.intel.some(
      (i) => i.id === a.targetId && !i.resolved && w.time - i.lastSeen <= RULES.intelTTL,
    ) ||
      w.locations.some(
        (l) => l.id === a.targetId && l.owner !== 'starfleet' && l.discovered && l.hull > 0,
      )
      ? ok()
      : no('目标不存在或情报已过期');
  }
  if (a.type === 'ESCORT')
    return a.targetId !== s.id && w.ships.some((x) => x.id === a.targetId)
      ? ok()
      : no('请选择其他己方舰船');
  if (a.type === 'RECOVER')
    return w.wrecks.some((x) => x.id === a.targetId && x.discovered) ? ok() : no('残骸尚未发现');
  const dest = w.locations.find(
    (l) => l.id === a.targetId && l.owner === 'starfleet' && l.hull > 0,
  );
  if (!dest) return no('己方设施不可用');
  if (a.type === 'REFIT') {
    const installed = s.modules.includes(a.moduleId);
    if (a.remove && !installed) return no('模块未安装');
    if (!a.remove && (installed || s.modules.length >= capabilities(s).moduleSlots))
      return no('模块已安装或槽位已满');
    if (a.remove && a.moduleId === 'expandedCargo' && cargoUsed(s) > capabilities(s).cargo - 50)
      return no('请先卸货，拆除后货舱容量不足');
  }
  if (
    a.type === 'REARM' &&
    (a.load.photon + s.photon > capabilities(s).photon ||
      a.load.quantum + s.quantum > capabilities(s).quantum ||
      a.load.photon + a.load.quantum === 0)
  )
    return no('装弹数量超出弹舱余量');
  return ok();
}
export function validate(
  this: SimulationEngine,
  input: unknown,
  actorId = 'commander',
): CommandResult {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return no('命令格式无效或数值越界');
  const c = parsed.data as Command,
    w = this.state;
  if (w.status !== 'active') return no('COMMAND LOST：只能恢复昨日或开始新边疆');
  if (
    actorId !== w.commander.id &&
    !(
      c.type === 'issueDirective' &&
      c.shipIds.length === 1 &&
      w.assignments.some((a) => a.operatorId === actorId && a.shipId === c.shipIds[0])
    )
  )
    return no('该操作者无此命令权限');
  if (c.type === 'issueDirective') {
    for (const id of c.shipIds) {
      const s = w.ships.find((s) => s.id === id);
      if (!s) return no('舰船不存在');
      if (
        (c.mode === 'QUEUE' && s.queue.length >= 32) ||
        (c.mode === 'INTERRUPT' && s.current && s.suspended.length >= 16)
      )
        return no('指令队列已满');
      const v = validateAction(this, s, c.action);
      if (!v.ok) return v;
    }
    return ok();
  }
  if (c.type === 'cancelDirective' || c.type === 'standingOrders')
    return w.ships.some((s) => s.id === c.shipId) ? ok() : no('舰船不存在');
  if (c.type === 'renameEntity')
    return w.ships.some((s) => s.id === c.entityId) ||
      w.locations.some((l) => l.id === c.entityId && l.owner === 'starfleet') ||
      w.systems.some((s) => s.id === c.entityId && s.discovered) ||
      w.bodies.some((b) => b.id === c.entityId && b.discovered && b.kind === 'planet')
      ? ok()
      : no('对象不可命名');
  if (c.type === 'startConstruction') {
    const b = w.bodies.find((b) => b.id === c.siteId && b.discovered),
      sys = w.systems.find((s) => s.id === c.siteId && s.discovered);
    if (!b && !sys) return no('请选择已发现地点');
    if ((b?.survey ?? sys?.survey ?? 0) < 2) return no('建设需要近距调查');
    if (c.kind === 'mine' && (!b || b.kind !== 'resource' || b.remaining <= 0))
      return no('矿场需要可采矿藏');
    if (c.kind === 'colony' && (!b || b.kind !== 'planet' || !b.habitable))
      return no('殖民地需要已确认宜居星球');
    if (c.kind === 'platform' && !w.upgrades.defense) return no('需要 Defense Grid 升级');
    if (
      w.projects.some((p) => p.siteId === c.siteId && p.kind === c.kind) ||
      w.locations.some((l) => l.siteId === c.siteId && l.kind === c.kind && l.hull > 0)
    )
      return no('该地点已有同类设施或项目');
    return w.resources.credits >= FACILITIES[c.kind].cost.credits ? ok() : no('Credits 不足');
  }
  if (c.type === 'buildShip') {
    if (!(c.classId in BUILD_COSTS)) return no('不可建造此舰级');
    if ((c.classId === 'constitution' || c.classId === 'galaxy') && !w.upgrades.shipyard)
      return no('需要 Shipyard 升级');
    return canPay(this, BUILD_COSTS[c.classId as keyof typeof BUILD_COSTS])
      ? ok()
      : no('造舰预算或实物库存不足');
  }
  if (c.type === 'upgrade') {
    if (
      w.upgrades[c.upgradeId] ||
      w.jobs.some((j) => j.kind === 'upgrade' && j.key === c.upgradeId && !j.complete)
    )
      return no('已升级或正在施工');
    return canPay(this, UPGRADES[c.upgradeId].cost) ? ok() : no('升级预算或库存不足');
  }
  if (c.type === 'manufacture') {
    if (c.cargoKind === 'quantum' && !w.upgrades.armory) return no('需要 Armory 升级');
    return canPay(this, manufactureCost(c.cargoKind, c.amount)) ? ok() : no('制造预算或材料不足');
  }
  if (c.type === 'sellStock')
    return available(w, 'base', c.cargoKind) >= c.amount ? ok() : no('可出售库存不足');
  if (c.type === 'repairFacility') {
    const l = w.locations.find(
      (l) => l.id === c.locationId && l.owner === 'starfleet' && l.hull > 0 && l.hull < l.maxHull,
    );
    return l && available(w, l.id, 'materials') >= 1 ? ok() : no('本地材料不足或设施无需维修');
  }
  if (c.type === 'acknowledge')
    return w.communications.some((m) => m.id === c.communicationId) ? ok() : no('通信不存在');
  return ok();
}
export const manufactureCost = (k: 'supplies' | 'photon' | 'quantum', amount: number) =>
  cost(
    amount * (k === 'quantum' ? 8 : 2),
    amount * (k === 'supplies' ? 0.3 : k === 'photon' ? 1 : 2),
  );
/** Revalidate what remains, rather than charging or loading an interrupted action twice. */
export function validateContinuation(e: SimulationEngine, s: Ship, d: Directive): CommandResult {
  const a = d.action;
  if (a.type === 'REARM' && d.phase === 'rearming')
    return validateAction(e, s, {
      ...a,
      load: { photon: d.reserved.photon, quantum: d.reserved.quantum },
    });
  if (a.type === 'MINE' && d.phase === 'unloading')
    return inventory(e.state, a.unloadId) ? ok() : no('卸货设施不可用');
  return validateAction(e, s, a);
}
export function makeDirective(e: SimulationEngine, action: Action): Directive {
  return {
    id: 'directive-' + e.state.nextId++,
    action: structuredClone(action),
    created: e.state.time,
    phase: 'starting',
    work: 0,
    moved: 0,
    carried: 0,
    delivered: 0,
    reserved: emptyStock(),
    paidCredits: 0,
    search: 0,
    note: '',
  };
}
export function dispatchCommand(
  this: SimulationEngine,
  input: unknown,
  actorId = 'commander',
): CommandResult {
  const valid = this.validate(input, actorId);
  if (!valid.ok) return valid;
  const c = commandSchema.parse(input) as Command,
    w = this.state;
  if (c.type === 'pause') {
    w.paused = c.paused;
    if (!c.paused) w.pauseReasons = [];
    return ok(c.paused ? '模拟暂停' : '模拟继续');
  }
  if (c.type === 'speed') {
    w.speed = c.speed;
    return ok('时间倍率已更新');
  }
  if (c.type === 'acknowledge') {
    w.communications.find((m) => m.id === c.communicationId)!.read = true;
    return ok('通信已确认');
  }
  if (c.type === 'issueDirective') {
    for (const id of c.shipIds) {
      const s = w.ships.find((s) => s.id === id)!,
        d = makeDirective(this, c.action);
      if (c.mode === 'QUEUE' && s.current) s.queue.push(d);
      else {
        if (c.mode === 'INTERRUPT' && s.current) s.suspended.push(s.current);
        if (c.mode === 'REPLACE') {
          s.current = null;
          s.queue = [];
          s.suspended = [];
        }
        s.current = d;
        s.path = [];
        s.status = 'active';
      }
      this.record('directive', s.name + ' / ' + c.mode + ' / ' + c.action.type, s.id);
    }
    return ok('Admiral 指令已接受：' + c.mode + ' / ' + c.action.type);
  }
  if (c.type === 'cancelDirective') {
    const s = w.ships.find((s) => s.id === c.shipId)!;
    s.current = null;
    s.queue = [];
    s.suspended = [];
    s.path = [];
    s.status = 'idle';
    this.record('directive', s.name + ' 取消指令；货物保留', s.id);
    return ok();
  }
  if (c.type === 'standingOrders') {
    w.ships.find((s) => s.id === c.shipId)!.standing = { roe: c.roe, retreatHull: c.retreatHull };
    return ok('自主政策已更新');
  }
  if (c.type === 'renameEntity') {
    const entity =
      w.ships.find((s) => s.id === c.entityId) ??
      w.locations.find((l) => l.id === c.entityId) ??
      w.systems.find((s) => s.id === c.entityId) ??
      w.bodies.find((b) => b.id === c.entityId);
    const old = entity!.name;
    entity!.name = c.name;
    if ('label' in entity!) entity!.label = c.name;
    this.record('rename', old + ' → ' + c.name, c.entityId);
    return ok('名称已保存');
  }
  if (c.type === 'startConstruction') {
    const site =
      w.bodies.find((b) => b.id === c.siteId) ?? w.systems.find((s) => s.id === c.siteId)!;
    const project = {
      id: 'project-' + w.nextId++,
      name: c.name,
      kind: c.kind,
      siteId: c.siteId,
      x: site.x,
      y: site.y,
      stock: emptyStock(),
      cost: structuredClone(FACILITIES[c.kind].cost),
      work: 0,
      duration: RULES.constructionMinutes,
      complete: false,
    };
    w.resources.credits -= project.cost.credits;
    w.projects.push(project);
    this.record('construction', c.name + ' 开工：等待实际材料与补给运抵', project.id);
    return ok('现场项目已建立，请运输材料和补给');
  }
  if (c.type === 'buildShip') {
    pay(this, BUILD_COSTS[c.classId as keyof typeof BUILD_COSTS]);
    w.jobs.push({
      id: 'job-' + w.nextId++,
      kind: 'ship',
      key: c.classId,
      name: c.name,
      amount: 1,
      work: 0,
      duration: RULES.shipBuildMinutes,
      complete: false,
    });
    this.record('industry', c.name + ' 进入 Shipyard 建造', 'base');
    return ok('已支付实物与预算，造舰开始');
  }
  if (c.type === 'upgrade') {
    pay(this, UPGRADES[c.upgradeId].cost);
    w.jobs.push({
      id: 'job-' + w.nextId++,
      kind: 'upgrade',
      key: c.upgradeId,
      name: UPGRADES[c.upgradeId].label,
      amount: 1,
      work: 0,
      duration: 15,
      complete: false,
    });
    return ok('战略升级施工开始');
  }
  if (c.type === 'manufacture') {
    pay(this, manufactureCost(c.cargoKind, c.amount));
    w.jobs.push({
      id: 'job-' + w.nextId++,
      kind: 'manufacture',
      key: c.cargoKind,
      name: c.cargoKind,
      amount: c.amount,
      work: 0,
      duration: Math.max(3, c.amount * 0.3),
      complete: false,
    });
    return ok('制造已使用真实材料');
  }
  if (c.type === 'sellStock') {
    this.base.stock[c.cargoKind] -= c.amount;
    const credits = RESOURCE_DEFINITIONS[c.cargoKind].price * c.amount;
    w.resources.credits += credits;
    this.record(
      'trade',
      '联邦出口：' + c.amount + ' ' + c.cargoKind + ' → ' + credits + ' Credits',
      'base',
    );
    return ok('出口完成，库存已消耗');
  }
  if (c.type === 'repairFacility') {
    const l = w.locations.find((l) => l.id === c.locationId)!,
      amount = Math.min(
        Math.ceil((l.maxHull - l.hull) / RULES.repairPerMaterial),
        Math.floor(available(w, l.id, 'materials')),
      );
    l.stock.materials -= amount;
    l.hull = Math.min(l.maxHull, l.hull + amount * RULES.repairPerMaterial);
    this.record('repair', l.name + ' 消耗 ' + amount + ' 本地 Materials', l.id);
    return ok('设施维修完成');
  }
  return ok();
}
export function submitAction(this: SimulationEngine, operatorId: string, input: Action) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return no('结构化动作格式无效');
  const a = this.state.assignments.find((a) => a.operatorId === operatorId),
    s = this.state.ships.find((s) => s.id === a?.shipId);
  if (!s) return no('执行主体不可用');
  if (s.current) return no('Admiral 当前指令优先');
  return this.dispatchCommand(
    { type: 'issueDirective', shipIds: [s.id], mode: 'QUEUE', action: parsed.data },
    operatorId,
  );
}
