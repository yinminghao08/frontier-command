import { shouldRetreat } from './combat';
import { RULES } from './definitions/rules';
import { SHIP_CLASSES } from './definitions/ships';
import type { SimulationEngine } from './engine';
import { applyDamage } from './lifecycle';
import { dist, objectivePosition, planRoute } from './navigation';
import { visibleIntel } from './sensors';
import type { OperationOrder, Point, Ship } from './types';

export function routeTarget(this: SimulationEngine, o: OperationOrder): Point | null {
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
export function setRoute(this: SimulationEngine, s: Ship, o: OperationOrder): void {
  const p = this.routeTarget(o);
  s.path = p ? planRoute(this.state, s, p, o.route === 'safe', o.border) : [];
}
export function returnHome(this: SimulationEngine, s: Ship): void {
  if (s.hull <= 0) return;
  s.status = 'returning';
  s.behavior = 'retreat';
  s.targetId = null;
  s.path = planRoute(this.state, s, this.berth(s), true, 'romulan');
}
export function releaseReservation(this: SimulationEngine, o: OperationOrder): void {
  if (o.reserved) {
    const src = this.state.locations.find((l) => l.id === o.sourceId)!;
    src.reserved[o.cargoKind] -= o.reserved;
    o.reserved = 0;
  }
}
export function settle(
  this: SimulationEngine,
  o: OperationOrder,
  outcome: OperationOrder['outcome'],
  reason: string,
): void {
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
export function beginInvestigation(
  this: SimulationEngine,
  o: OperationOrder,
  approach: 'remote' | 'close',
): void {
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
export function dock(this: SimulationEngine, s: Ship): void {
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
export function advanceOrder(this: SimulationEngine, o: OperationOrder, dt: number): void {
  const w = this.state,
    ships = w.ships.filter((s) => s.orderId === o.id && s.status === 'mission'),
    s = ships[0];
  if (o.settled) {
    if (!w.ships.some((s) => s.orderId === o.id)) {
      o.phase = 'complete';
    }
    return;
  }
  if (
    o.kind === 'defense' &&
    o.objective.type === 'ship' &&
    w.losses.some((l) => l.shipId === o.objective.id)
  ) {
    this.settle(o, 'failed', '保护目标已摧毁');
    return;
  }
  if (!s) {
    this.settle(o, 'failed', '已无可执行资产');
    return;
  }
  if (
    o.kind === 'transport' &&
    w.locations.some((l) => l.hull <= 0 && (l.id === o.sourceId || l.id === o.objective.id))
  ) {
    this.settle(o, 'failed', '物流设施已摧毁');
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
    const cost = RULES.surveyCorePerMinute * (o.approach === 'close' ? 1.5 : 1) * dt;
    if (s.core < cost) {
      this.settle(o, 'failed', '调查能源不足');
      return;
    }
    s.core -= cost;
    s.scanUntil = Math.max(s.scanUntil, w.time + 1);
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
      applyDamage(this, s, dt * 2);
      if (s.hull <= 0) return;
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
export function withdraw(this: SimulationEngine, s: Ship, o: OperationOrder, reason: string): void {
  this.returnHome(s);
  if (
    o.kind !== 'defense' ||
    !this.state.ships.some((x) => x.id !== s.id && x.orderId === o.id && x.status === 'mission')
  )
    this.settle(o, 'failed', reason);
  else this.report(s.name + ' 撤退，其余资产继续防御', o.id, 'high');
}
