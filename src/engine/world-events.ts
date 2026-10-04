import type { SimulationEngine } from './engine';
import type { Directive, Ship, WorldEvent, WorldEventKind } from './types';
import { RULES } from './definitions/rules';
import { available } from './inventory';
import { capabilities, cargoUsed } from './capabilities';
import { personnelBonus } from './society';
export const EVENT_LABELS: Record<WorldEventKind, string> = {
  wormhole: 'Wormhole 调查',
  plague: '殖民地疫情',
  invasion: '军事入侵',
  accident: '矿场事故',
  distress: '遇险求援',
  refugees: '难民撤离',
  discovery: '科学发现',
  derelict: '失落舰船',
  diplomatic: '外交警告',
};
export function createEvent(
  e: SimulationEngine,
  kind: WorldEventKind,
  subjectId: string,
  evidence: string,
  assetIds: string[] = [],
) {
  const existing = e.state.events.find(
    (v) =>
      v.kind === kind && v.subjectId === subjectId && ['reported', 'responding'].includes(v.stage),
  );
  if (existing) return existing;
  const v: WorldEvent = {
    id: 'event-' + e.state.nextId++,
    kind,
    subjectId,
    created: e.state.time,
    deadline: e.state.time + 240,
    stage: 'reported',
    evidence,
    choice: null,
    work: 0,
    population: 0,
    carrierId: null,
    targetId: null,
    assetIds,
    followUpId: null,
    outcome: '',
  };
  e.state.events.push(v);
  e.record('event', EVENT_LABELS[kind] + '：' + evidence, v.id);
  return v;
}
export function finishEvent(e: SimulationEngine, v: WorldEvent, outcome: string, failed = false) {
  if (['resolved', 'failed'].includes(v.stage)) return;
  v.stage = failed ? 'failed' : 'resolved';
  v.outcome = outcome;
  e.record('event', EVENT_LABELS[v.kind] + '：' + outcome, v.id);
}
export function eventAt(e: SimulationEngine, v: WorldEvent) {
  return [
    ...e.state.locations,
    ...e.state.ships,
    ...e.state.civilians,
    ...e.state.bodies,
    ...e.state.wrecks,
    ...e.state.wormholes,
  ].find((x) => x.id === v.subjectId);
}
export function advanceEvents(e: SimulationEngine, dt: number) {
  const w = e.state;
  if (w.tick % 10 === 0) {
    for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)) {
      if (l.distress && w.time - l.attackedAt < 30)
        createEvent(e, 'distress', l.id, l.name + '遭到实际攻击，请求防卫');
      if (
        l.kind === 'mine' &&
        l.extracted * (w.bodies.find((b) => b.id === l.siteId)?.hazard ?? 0) >= 180
      ) {
        l.extracted = 0;
        createEvent(e, 'accident', l.id, l.name + '累计开采暴露超出安全阈值，设备停工');
      }
      const c = l.colony;
      if (c && (c.contamination > 20 || c.population > c.housing * 0.95)) {
        c.contamination = Math.max(c.contamination, 30);
        createEvent(e, 'plague', l.id, l.name + '污染或拥挤达到疫情阈值');
      }
    }
    for (const s of [...w.ships, ...w.civilians])
      if (s.hull < capabilities(s).hull * 0.5 && w.time - s.attackedAt < 30)
        createEvent(e, 'distress', s.id, s.name + '舰体受损，需要现场保障');
    for (const b of w.bodies.filter((b) => b.discovered && b.survey >= 2)) {
      if (
        (b.hidden || b.kind === 'ruins') &&
        !b.specialClaimed &&
        !w.events.some((v) => v.subjectId === b.id && v.kind === 'discovery')
      )
        createEvent(e, 'discovery', b.id, b.name + '已完成近距调查，需要科学研究');
      if (
        b.kind === 'derelict' &&
        !w.events.some((v) => v.subjectId === b.id && v.kind === 'derelict')
      )
        createEvent(e, 'derelict', b.id, b.name + '存在真实可打捞库存');
      if (
        b.population > 0 &&
        b.hazard > 0.2 &&
        !w.events.some((v) => v.kind === 'refugees' && v.subjectId === b.id)
      )
        createEvent(e, 'refugees', b.id, b.name + '居民受环境风险威胁，申请撤离');
    }
    for (const h of w.wormholes.filter((h) => h.discovered && !h.surveyed))
      createEvent(e, 'wormhole', h.id, h.name + '探测到通道，需要确认稳定性');
  }
  for (const v of w.events.filter((v) => ['reported', 'responding'].includes(v.stage))) {
    const target = eventAt(e, v);
    if (!target || ('hull' in target && target.hull <= 0)) {
      finishEvent(e, v, '主体永久损失', true);
      continue;
    }
    const facility = w.locations.find((l) => l.id === v.subjectId);
    const damaged = facility ?? [...w.ships, ...w.civilians].find((s) => s.id === v.subjectId);
    if (v.kind === 'plague' && facility?.colony) {
      const c = facility.colony;
      c.contamination = Math.min(
        100,
        Math.max(0, c.contamination + dt * (c.quarantine ? -0.15 : 0.04)),
      );
      c.population = Math.max(0, c.population - (dt * c.population * c.contamination) / 1000000);
      c.morale = Math.max(10, c.morale - dt * 0.01);
      if (c.contamination === 0) finishEvent(e, v, '隔离与治疗已消除疫情');
    }
    if (
      v.kind === 'distress' &&
      damaged &&
      damaged.hull >=
        ('maxHull' in damaged ? damaged.maxHull : capabilities(damaged).hull) * 0.75 &&
      w.time - damaged.attackedAt > 30
    )
      finishEvent(e, v, '主体已脱离危险并恢复保障');
    if (
      v.kind === 'refugees' &&
      v.carrierId &&
      v.population > 0 &&
      !w.ships.some((s) => s.id === v.carrierId)
    ) {
      finishEvent(e, v, '运输舰与撤离人口永久损失', true);
      continue;
    }
    if (
      v.kind === 'invasion' &&
      v.assetIds.every(
        (id) =>
          !w.enemies.some((s) => s.id === id && s.intent !== 'retreat' && s.intent !== 'docked'),
      )
    )
      finishEvent(e, v, '入侵舰队已撤退或被摧毁');
    if (v.kind === 'diplomatic' && target.x < 780) {
      w.tension = Math.max(0, w.tension - 5);
      finishEvent(e, v, '已实际撤离争议空间');
    }
    if (
      w.time > v.deadline &&
      v.stage === 'reported' &&
      ['refugees', 'diplomatic', 'derelict'].includes(v.kind)
    ) {
      if (v.kind === 'diplomatic') {
        w.tension = Math.min(100, w.tension + 10);
        const report = w.factions.romulan.reports.find(
          (r) => r.id === v.subjectId && w.time - r.seenAt < RULES.reportTTL,
        );
        const assets = w.enemies.filter((s) => s.factionId === 'romulan' && s.role === 'warbird');
        if (report && assets.length && w.tension >= 65) {
          w.factions.romulan.stance = 'escalate';
          for (const asset of assets) {
            asset.intent = 'probe';
            asset.targetId = report.id;
            asset.destination = { x: report.x, y: report.y };
            asset.nextDecision = w.time;
          }
          const follow = createEvent(
            e,
            'invasion',
            v.subjectId,
            '撤离要求被拒绝，依据新鲜情报部署现役军舰',
            assets.map((s) => s.id),
          );
          v.followUpId = follow.id;
        }
      }
      finishEvent(e, v, '响应期限已过，后果进入历史', true);
    }
  }
}
/** The caller moves the vessel; events never teleport response ships or inventories. */
export function assistEvent(
  e: SimulationEngine,
  s: Ship,
  d: Directive,
  dt: number,
  travel: (p: { x: number; y: number }) => boolean,
) {
  const v = e.state.events.find((v) => v.id === ('targetId' in d.action ? d.action.targetId : ''));
  if (!v || ['resolved', 'failed'].includes(v.stage)) {
    e.complete(s, '事件已结束');
    return;
  }
  const target = eventAt(e, v);
  if (!target) {
    e.complete(s, '事件主体不可用', true);
    return;
  }
  if (['invasion', 'diplomatic'].includes(v.kind)) {
    e.complete(s, '需要实际防卫、通信或撤离行动', true);
    return;
  }
  if (v.kind === 'refugees' && v.choice !== 'accept') {
    d.note = '等待 Admiral 接受并指定安置殖民地';
    return;
  }
  if (v.kind === 'refugees' && v.carrierId && v.carrierId !== s.id) {
    d.note = '等待已指定运输舰完成撤离';
    return;
  }
  v.stage = 'responding';
  v.carrierId = s.id;
  if (v.kind === 'refugees') {
    const destination = e.state.locations.find(
      (l) => l.id === v.targetId && l.colony && l.hull > 0,
    );
    if (!destination) {
      e.complete(s, '安置殖民地不可用', true);
      return;
    }
    if (!v.population) {
      if (!travel(target)) return;
      if (!('population' in target)) return;
      const n = Math.min(
        target.population,
        100,
        Math.floor((capabilities(s).cargo - cargoUsed(s)) * 5),
      );
      if (n <= 0) {
        d.note = '没有人员运输空间';
        return;
      }
      target.population -= n;
      s.passengers += n;
      v.population = n;
      e.record('refugees', '实际登舰 ' + n + ' 人', s.id);
    }
    if (!travel(destination)) return;
    const n = Math.min(s.passengers, v.population);
    s.passengers -= n;
    destination.colony!.population += n;
    destination.colony!.stability = Math.max(0, destination.colony!.stability - 5);
    destination.colony!.contamination = Math.min(100, destination.colony!.contamination + 15);
    finishEvent(e, v, n + ' 人已抵达 ' + destination.name);
    e.complete(s, '难民真实转移完成');
    return;
  }
  if (!travel(target)) return;
  const facility = e.state.locations.find((l) => l.id === v.subjectId);
  const power =
    1 +
    capabilities(s).science / 100 +
    personnelBonus(e, s.id, 'science') +
    (facility?.colony
      ? facility.colony.science / 200 + personnelBonus(e, facility.id, 'science')
      : 0);
  const damaged =
    facility ?? [...e.state.ships, ...e.state.civilians].find((s) => s.id === v.subjectId);
  if (v.kind === 'plague') {
    if (!facility?.colony) return;
    const n = dt * 0.2;
    if (available(e.state, facility.id, 'supplies') < n) {
      d.note = '等待现场医疗补给';
      return;
    }
    facility.stock.supplies -= n;
    facility.colony.contamination = Math.max(0, facility.colony.contamination - dt * power);
  }
  if (v.kind === 'distress' && damaged) {
    const stock = facility?.stock ?? s.cargo;
    if ((facility ? available(e.state, facility.id, 'materials') : stock.materials) < dt) {
      d.note = '等待现场或响应舰货舱维修材料';
      return;
    }
    stock.materials -= dt;
    damaged.hull = Math.min(
      'maxHull' in damaged ? damaged.maxHull : capabilities(damaged).hull,
      damaged.hull + dt * 8,
    );
  }
  d.work += dt * power;
  v.work += dt * power;
  d.note = '现场响应：' + EVENT_LABELS[v.kind] + ' ' + Math.floor(v.work) + '/20';
  if (v.work < 20) return;
  if (
    v.kind === 'distress' &&
    damaged &&
    damaged.hull < ('maxHull' in damaged ? damaged.maxHull : capabilities(damaged).hull) * 0.75
  )
    return;
  if (v.kind === 'accident') {
    if (!('stock' in target) || available(e.state, target.id, 'materials') < 5) {
      d.note = '需要现场 5 Materials 修复设备';
      return;
    }
    target.stock.materials -= 5;
  }
  if (v.kind === 'discovery' && 'specialClaimed' in target) {
    if (cargoUsed(s) >= capabilities(s).cargo) {
      d.note = '研究样本需要货舱空间';
      return;
    }
    target.specialClaimed = true;
    s.cargo.specialFinds++;
  }
  if (v.kind === 'plague' && facility?.colony) {
    facility.colony.contamination = 0;
    facility.colony.morale = Math.min(100, facility.colony.morale + 5);
  }
  if (v.kind === 'wormhole' && 'surveyed' in target) {
    if (v.choice === 'stabilize') {
      if (s.cargo.materials < 5) {
        d.note = '稳定通道需要响应舰货舱 5 材料';
        return;
      }
      s.cargo.materials -= 5;
      target.stability = Math.min(1, target.stability + 0.3);
      target.stable = target.stability >= 0.7;
    }
    target.surveyed = true;
  }
  if (v.kind === 'derelict') {
    const wreck = e.state.wrecks.find((x) => x.id === 'wreck:' + target.id);
    if (wreck) wreck.discovered = true;
    if ('hazard' in target && target.hazard > 0.4) {
      const colony = e.state.locations.find((l) => l.colony && l.hull > 0);
      if (colony) {
        colony.colony!.contamination = Math.min(100, colony.colony!.contamination + 25);
        const follow = createEvent(
          e,
          'plague',
          colony.id,
          '失落舰船研究引入污染样本，需要医疗响应',
        );
        v.followUpId = follow.id;
      }
    }
  }
  finishEvent(e, v, '现场行动完成，结果永久保存');
  e.complete(s, '事件响应完成');
}
