import { recordCargoTransfer } from './agent-runtime/journal';
import { unlockProductionDiscount } from './production';
import { BASE_REFIT } from './definitions/progression';
import { deposit, haulLoad } from './inventory';
import { directiveFeedback } from './directive-feedback';
import { agentOutcome } from './agents';
import type { Action } from './types';
import {
  advanceStanding,
  autonomousAllowed,
  groupSpeed,
  groupPeers,
  prepareGroupHaul,
} from './fleet';
import { assistEvent, createEvent } from './world-events';
import { personnelBonus } from './society';
import type { SimulationEngine } from './engine';
import type { Directive, Point, Ship } from './types';
import { GOODS } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { dist, move, routeSpeedMultiplier } from './navigation';
import { planJourney } from './journey';
import { transit } from './transit';
import { regenerate } from './combat';
import { available, inventory, validateAction } from './command-system';
import { RULES } from './definitions/rules';
import { MODULES, cost } from './definitions/progression';
import { sectorCenter, materialize } from './world-generation';
import { regionAt } from './definitions/locations';
import { SHIP_CLASSES } from './definitions/ships';
import { TRACKING_RULES } from './tracking';
import { appendChat, COMMAND_CHANNEL } from './chat';
import { piracyTransferHolds } from './orion/piracy';
function borderCrossing(e: SimulationEngine, s: Ship, previous: Point) {
  const from = regionAt(previous.x, previous.y),
    to = regionAt(s.x, s.y);
  if (from === to) return;
  if ((to === 'neutral' || to === 'romulan') && from !== 'romulan') {
    const amount = to === 'romulan' ? 12 : 8;
    e.state.tension = Math.min(100, e.state.tension + amount);
    e.record('borderTransit', s.name + ' 进入 ' + to.toUpperCase() + '：tension +' + amount, s.id);
  } else if (from === 'neutral' || from === 'romulan') {
    e.state.tension = Math.max(0, e.state.tension - 4);
    e.record('borderTransit', s.name + ' 撤离边境：tension -4', s.id);
  }
}
export function go(
  e: SimulationEngine,
  s: Ship,
  d: Directive,
  p: Point,
  dt: number,
  route?: 'safe' | 'direct' | 'risky',
  range = 6,
) {
  const allowed = (p: Point) => autonomousAllowed(s, p);
  if (
    d.source !== 'admiral' &&
    (!allowed(p) ||
      (d.source === 'standing' &&
        ['INTERCEPT', 'SHADOW', 'ESCORT', 'ASSIST_EVENT'].includes(d.action.type) &&
        dist(d.origin, p) > s.standing.maxPursuit))
  ) {
    e.complete(s, '自主行动超出追击范围或边境权限', true);
    return false;
  }
  if (dist(s, p) <= range + 1e-8) {
    s.path = [];
    d.journey = null;
    return true;
  }
  const distance = dist(s, p),
    target = {
      x: p.x + ((s.x - p.x) * range) / distance,
      y: p.y + ((s.y - p.y) * range) / distance,
    };
  if (
    !d.journey ||
    dist(d.journey.destination, target) > 25 ||
    d.journey.legIndex >= d.journey.legs.length
  ) {
    const tolerance =
      e.state.agents.find((a) => a.id === d.actorId)?.personality.riskTolerance ?? 40;
    d.journey = {
      ...planJourney(e.state, s, target, route, tolerance, d.allowWormholes),
      legIndex: 0,
      transitWork: 0,
    };
    s.path = [];
  }
  const journey = d.journey,
    leg = journey.legs[journey.legIndex];
  if (!leg) return false;
  if (
    d.source !== 'admiral' &&
    journey.legs.some(
      (l) => !allowed(l.destination) || (l.type === 'warp' && l.path.some((p) => !allowed(p))),
    )
  ) {
    e.complete(s, '自主航线超出边境权限', true);
    return false;
  }
  const previous = { x: s.x, y: s.y };
  if (leg.type === 'wormhole') {
    const h = e.state.wormholes.find((h) => h.id === leg.wormholeId && h.discovered && h.surveyed);
    if (!h || dist(h.exit, leg.destination) > 1e-8) {
      d.journey = null;
      s.path = [];
      return false;
    }
    if (dist(s, h) > 8) {
      d.journey = null;
      s.path = [];
      return false;
    }
    journey.transitWork += dt;
    d.note = 'TRANSIT / ' + h.name + ' / ' + journey.transitWork.toFixed(1) + ' / 2';
    if (journey.transitWork + 1e-8 >= 2) {
      if (!transit(e, s, h)) return false;
      journey.legIndex++;
      journey.transitWork = 0;
      borderCrossing(e, s, previous);
    }
    return false;
  }
  if (!s.path.length) s.path = structuredClone(leg.path);
  if (
    s.path[0] &&
    move(s, s.path[0], dt, routeSpeedMultiplier(e.state.upgrades, leg.route) * groupSpeed(e, s, d))
  )
    s.path.shift();
  if (!s.path.length) journey.legIndex++;
  borderCrossing(e, s, previous);
  d.moved += dist(previous, s);
  d.note =
    '航行 / ' +
    leg.route +
    ' / Journey ' +
    Math.min(journey.legIndex + 1, journey.legs.length) +
    '/' +
    journey.legs.length;
  if (leg.route === 'risky') e.hit(s, 0.75 * dt * capabilities(s).hazardFactor);
  return dist(s, p) <= range + 1e-8;
}
function survey(
  e: SimulationEngine,
  s: Ship,
  d: Directive,
  target: Point,
  dt: number,
  close: boolean,
  power: number,
  hazard = 0,
) {
  if (!go(e, s, d, target, dt, 'direct', close ? 8 : capabilities(s).sensors * 0.65)) return false;
  const drain = (close ? 3.2 : 2.5) * dt;
  if (s.core < drain) {
    d.note = 'Core 恢复中';
    return false;
  }
  s.core -= drain;
  s.scanUntil = e.state.time + 2;
  if (close && hazard) e.hit(s, hazard * 2 * dt * capabilities(s).hazardFactor);
  if (s.hull <= 0) return false;
  d.work += dt;
  d.note = close ? 'Close Survey / 现场采样' : 'Remote Scan / 测绘';
  return (
    d.work >=
    (((RULES.surveyMinutes * 70) / Math.max(20, power)) * (close ? 1.3 : 1)) /
      (1 + personnelBonus(e, s.id, 'science'))
  );
}
function reveal(e: SimulationEngine, s: Ship, systemId: string, tier: number, deep: boolean) {
  const sys = e.state.systems.find((x) => x.id === systemId)!;
  const fresh = !sys.discovered;
  sys.discovered = true;
  sys.survey = Math.max(sys.survey, tier);
  for (const b of e.state.bodies.filter((b) => b.systemId === systemId && (!b.hidden || deep))) {
    b.discovered = true;
    b.survey = Math.max(b.survey, tier);
  }
  if (fresh) {
    e.record('discovery', s.name + ' 发现 ' + sys.name + '，永久星图已更新', sys.id);
  }
}
function arrivedService(e: SimulationEngine, s: Ship, d: Directive, dt: number) {
  const a = d.action;
  if (!('targetId' in a)) return false;
  const l = e.state.locations.find(
    (l) => l.id === a.targetId && l.owner === 'starfleet' && l.hull > 0,
  );
  if (!l) {
    e.complete(s, '保障设施已失效', true);
    return false;
  }
  if (!go(e, s, d, l, dt, 'safe', 12)) return false;
  s.status = 'docked';
  return true;
}
export function advanceShip(e: SimulationEngine, s: Ship, dt: number) {
  const w = e.state;
  regenerate(s, w.time, dt);
  if (piracyTransferHolds(e, s)) {
    s.status = 'active';
    return;
  }
  if (s.current?.action.type === 'REST') {
    const site = w.locations.find(
      (l) => l.id === (s.current?.action.type === 'REST' ? s.current.action.targetId : ''),
    );
    if (!site || dist(s, site) > 12) s.current.work = 0;
  }
  advanceStanding(e, s);
  if (s.emergencyRetreat) {
    if (move(s, s.emergencyRetreat.point, dt)) {
      s.emergencyRetreat = null;
      s.status = 'idle';
    }
    return;
  }
  const d = s.current;
  if (!d) {
    autonomousFire(e, s);
    return;
  }
  if (d.action.type === 'ATTACK_SET' && (d.targetIndex ?? 0) >= d.action.targetIds.length) {
    e.complete(
      s,
      '所选目标序列已处理' +
        (d.unconfirmedTargets?.length
          ? '；未确认战果：' + d.unconfirmedTargets.join('、')
          : '；已确认摧毁'),
    );
    return;
  }
  const a: Action =
      d.action.type === 'ATTACK_SET'
        ? { type: 'ATTACK', targetId: d.action.targetIds[d.targetIndex ?? 0] }
        : d.action,
    c = capabilities(s);
  if (a.type === 'RETURN') {
    if (go(e, s, d, e.base, dt, 'safe', 12)) {
      e.complete(s, '返回 Dawn Starbase，货物保留');
      if (!s.current) s.status = 'docked';
    }
  } else if (a.type === 'ASSIST_EVENT') {
    assistEvent(e, s, d, dt, (p) => go(e, s, d, p, dt, 'safe', RULES.eventResponseRange));
  } else if (a.type === 'HAIL') {
    const contact = w.intel.find((i) => i.id === a.targetId && i.live);
    if (!contact) {
      e.complete(s, '通信接触失联', true);
      return;
    }
    if (go(e, s, d, contact, dt, 'direct', 200)) {
      const rom = w.enemies.find((x) => x.id === contact.id);
      if (rom && a.message === 'withdraw' && w.tension < 35) {
        rom.intent = 'retreat';
        const home = w.locations.find((l) => l.id === rom.homeId);
        rom.destination = home ? { x: home.x, y: home.y } : null;
      }
      w.tension = Math.max(
        0,
        w.tension - (a.message === 'deescalate' ? 5 + 5 * personnelBonus(e, s.id, 'diplomacy') : 0),
      );
      s.cooldowns.hail = 60;
      e.record(
        'diplomacy',
        s.name +
          '向 ' +
          (contact.name ?? contact.id) +
          '发送 ' +
          {
            greeting: 'Hail：和平呼叫',
            withdraw: 'Demand Withdrawal：撤离请求',
            deescalate: '外交降温',
          }[a.message] +
          '，Border Command 已记录',
        contact.id,
      );
      e.complete(s, 'Hail 已完成');
    }
  } else if (a.type === 'CAPTURE') {
    const target = w.locations.find(
      (l) => l.id === a.targetId && l.occupation === 'ruined' && l.owner !== 'starfleet',
    );
    if (!target) {
      e.complete(s, '遗址已接管或不可用', true);
      return;
    }
    if (go(e, s, d, target, dt, 'direct', BASE_REFIT.captureRange)) {
      if (w.time - s.attackedAt <= 8) {
        d.note = '接管暂停：等待脱离交火';
        return;
      }
      d.phase = 'capturing';
      d.work += dt;
      d.note = '现场接管 ' + Math.floor(d.work) + '/' + BASE_REFIT.captureMinutes + ' 分钟';
      if (d.work + 1e-8 >= BASE_REFIT.captureMinutes) {
        if (target.owner === 'romulan') {
          w.tension = Math.min(100, w.tension + 20);
          e.record(
            'diplomacy',
            '接管罗慕伦设施 ' + target.name + '：边境紧张度提高 20，当前 ' + w.tension,
            target.id,
          );
        }
        target.owner = 'starfleet';
        w.siteIntel = w.siteIntel.filter((i) => i.locationId !== target.id);
        target.occupation = 'secured';
        target.distress = false;
        target.discovered = true;
        e.record('capture', target.name + ' 已现场接管，等待运输材料改建基地', target.id);
        e.complete(s, '基地遗址接管完成');
      }
    }
  } else if (a.type === 'TRANSIT') {
    const h = w.wormholes.find((h) => h.id === a.targetId && h.discovered);
    if (!h) {
      e.complete(s, '通道失效', true);
      return;
    }
    if (go(e, s, d, h, dt, 'direct', 8)) {
      d.work += dt;
      if (d.work >= 2) {
        const previous = { x: s.x, y: s.y };
        if (!transit(e, s, h)) return;
        borderCrossing(e, s, previous);
        e.complete(s, 'Wormhole 航行完成');
      }
    }
  } else if (a.type === 'MOVE') {
    const spacing = d.groupSpacing;
    const point =
      d.groupOrderId && d.groupSlot
        ? {
            x: a.point.x + (d.groupSlot % 2 ? 1 : -1) * Math.ceil(d.groupSlot / 2) * spacing,
            y: a.point.y + Math.ceil(d.groupSlot / 2) * spacing,
          }
        : a.point;
    if (go(e, s, d, point, dt)) e.complete(s, '抵达坐标');
  } else if (a.type === 'EXPLORE') {
    const close = a.approach === 'close',
      p = sectorCenter(a.sector);
    if (survey(e, s, d, p, dt, close, c.science, close ? 0.25 : 0)) {
      const sec = materialize(w, a.sector);
      const fresh = !sec.discovered;
      sec.discovered = true;
      for (const h of w.wormholes.filter((h) => h.sectorId === sec.id)) h.discovered = true;
      for (const id of sec.systemIds) reveal(e, s, id, close ? 2 : 1, false);
      if (fresh)
        e.record(
          'discovery',
          '新 Sector ' + a.sector.q + '/' + a.sector.r + ' 已进入永久星图',
          sec.id,
        );
      e.complete(
        s,
        '实际生成 ' + sec.systemIds.length + ' 个 Star System；可选择资源点与行星继续调查',
      );
    }
  } else if (a.type === 'SURVEY') {
    const b = w.bodies.find((b) => b.id === a.targetId && b.discovered),
      sys = w.systems.find((x) => x.id === a.targetId && x.discovered),
      target = b ?? sys;
    if (!target) {
      e.complete(s, '调查目标失效', true);
      return;
    }
    if (survey(e, s, d, target, dt, a.approach === 'close', c.science, b?.hazard ?? 0.2)) {
      const tier = a.approach === 'close' ? 2 : 1;
      if (sys) reveal(e, s, sys.id, tier, a.deep);
      if (b) {
        b.survey = Math.max(b.survey, tier);
        if (
          tier === 2 &&
          b.kind === 'anomaly' &&
          !b.hidden &&
          !b.specialClaimed &&
          cargoUsed(s) < c.cargo
        ) {
          b.specialClaimed = true;
          s.cargo.specialFinds++;
          unlockProductionDiscount(e);
          e.record('discovery', '从 ' + b.name + ' 取得 Special Find，存入真实货舱', b.id);
        }
        if (a.deep) reveal(e, s, b.systemId, 1, true);
      }
      e.record(
        'survey',
        target.name + ' / ' + a.approach + (a.deep ? ' / DEEP SCAN' : ''),
        target.id,
      );
      e.complete(s, a.deep ? '隐藏异常已进入星图' : '调查完成；信息与矿藏持久保存');
      for (const body of w.bodies.filter(
        (body) =>
          body.discovered &&
          body.survey >= 2 &&
          body.kind === 'derelict' &&
          (body.id === a.targetId || body.systemId === a.targetId),
      )) {
        if (!w.events.some((v) => v.kind === 'derelict' && v.subjectId === body.id))
          createEvent(
            e,
            'derelict',
            body.id,
            body.id === 'veil-derelict'
              ? body.name + '无人舰桥已确认，可现场接管'
              : body.name + '存在真实可打捞库存',
          );
      }
    }
  } else if (a.type === 'LOAD') {
    const source=inventory(w,a.sourceId);
    if(!source){e.complete(s,'装载来源已失效',true);return;}
    if(!go(e,s,d,source,dt,a.route,8))return;
    if(d.phase==='starting') {
      const availableAmount=Math.min(c.cargo-cargoUsed(s),available(w,source.id,a.cargoKind)),amount=a.cargoKind==='materials'?availableAmount:Math.floor(availableAmount);
      if(amount<=1e-8){d.note=cargoUsed(s)>=c.cargo?'货舱已满，请卸货或改令':'等待实际生产或库存';return;}
      d.reserved[a.cargoKind]=amount;d.phase='loading';d.work=0;
    }
    d.work+=dt;d.note='装载真实货物';
    if(d.work+1e-8>=RULES.loadMinutes/(1+personnelBonus(e,s.id,'logistics'))) {
      const amount=d.reserved[a.cargoKind];
      if(source.stock[a.cargoKind]+1e-8<amount||c.cargo-cargoUsed(s)+1e-8<amount){e.complete(s,'装载预留已失效',true);return;}
      source.stock[a.cargoKind]-=amount;s.cargo[a.cargoKind]+=amount;d.reserved[a.cargoKind]=0;d.carried+=amount;
      recordCargoTransfer(e,s.id,source.id,s.id,a.cargoKind,amount,'loaded',d);
      e.record('cargo',s.name+' 实际装载 '+amount+' '+a.cargoKind,source.id,false);
      e.complete(s,'已装载实际库存，货物保留');
    }
  } else if (a.type === 'HAUL') {
    const src = inventory(w, a.sourceId),
      dest = inventory(w, a.targetId);
    if (!src || !dest) {
      e.complete(s, '物流端点失效；已装载货物保留', true);
      return;
    }
    if (d.phase === 'starting') {
      if (!go(e, s, d, src, dt, a.route, 8)) return;
      if (d.groupOrderId) {
        prepareGroupHaul(e, d);
        if (d.phase === 'starting') {
          d.note = '等待编队集结与实际库存';
          return;
        }
      }
      const amount = haulLoad(w, s, a, Math.max(0, d.carried - d.delivered - (d.lost ?? 0)));
      if (amount <= 0 && d.phase === 'starting') {
        if (d.carried > d.delivered && s.cargo[a.cargoKind] > 0) {
          d.phase = 'delivering';
          d.journey = null;
          return;
        }
        d.note =
          cargoUsed(s) >= c.cargo
            ? '货舱已满，请卸货或改令'
            : dest.stock[a.cargoKind] >= dest.capacity[a.cargoKind]
              ? '目的仓库已满，等待仓位或改令'
              : 'cost' in dest &&
                  ['materials', 'specialFinds'].includes(a.cargoKind) &&
                  dest.stock[a.cargoKind] >=
                    dest.cost[a.cargoKind === 'materials' ? 'materials' : 'specialFinds']
                ? '建设需求已满足，无需继续装载'
                : available(w, src.id, a.cargoKind) < 1
                  ? '等待实际生产或库存'
                  : '目的地空位已被在途交付占用，等待仓位或改令';
        directiveFeedback(e, d, d.note, 'load-blocked');
        return;
      }
      if (available(w, src.id, a.cargoKind) + 1e-8 < amount) {
        d.note = '等待起点实际库存 ' + amount + ' ' + a.cargoKind;
        return;
      }
      if (d.phase === 'starting') {
        d.reserved[a.cargoKind] = amount;
        d.phase = 'loading';
        d.work = 0;
      }
    }
    if (d.phase === 'loading') {
      if (!go(e, s, d, src, dt, a.route, 8)) return;
      d.work += dt;
      d.note = '装载真实货物';
      if (d.work >= RULES.loadMinutes / (1 + personnelBonus(e, s.id, 'logistics'))) {
        const n = d.reserved[a.cargoKind];
        if (src.stock[a.cargoKind] + 1e-8 < n) {
          e.complete(s, '预留库存失效', true);
          return;
        }
        src.stock[a.cargoKind] -= n;
        s.cargo[a.cargoKind] += n;
        recordCargoTransfer(e,s.id,src.id,s.id,a.cargoKind,n,'loaded',d);
        d.carried += n;
        d.reserved[a.cargoKind] = 0;
        d.phase = 'delivering';
        d.journey = null;
        d.work = 0;
        s.path = [];
        const text = s.name + ' 装载 ' + n + ' ' + a.cargoKind + '；真实航线启用';
        directiveFeedback(e, d, text + '；本次实际运输 ' + d.carried, 'loaded');
        e.record('cargo', text, s.id, false);
        appendChat(e, d.actorId, COMMAND_CHANNEL, text, [], 'report', {
          eventId: `${d.id}:${d.cycle}:loaded`,
        });
      }
    } else if (d.phase === 'delivering') {
      const escortRequests = w.escortRequests.filter(
        (r) =>
          r.targetShipId === s.id && r.kind === 'escort' && r.status === 'accepted' && !r.started,
      );
      if (
        escortRequests.some((r) => {
          const peer = w.ships.find(
            (p) => p.id === w.agents.find((a) => a.id === r.responderId)?.assignedShipId,
          );
          return (
            !peer ||
            peer.current?.action.type !== 'ESCORT' ||
            peer.current.action.targetId !== s.id ||
            dist(peer, s) >= 60
          );
        })
      ) {
        d.note = '等待已承诺护航会合';
        return;
      }
      for (const request of escortRequests) request.started = true;
      if (d.groupOrderId && groupPeers(e, d).some((p) => p.current?.phase === 'loading')) {
        d.note = '等待编队共同出发';
        return;
      }
      if (!go(e, s, d, dest, dt, a.route, 8)) return;
      d.work += dt;
      d.note = '卸货至 ' + dest.name;
      if (d.work >= RULES.loadMinutes / (1 + personnelBonus(e, s.id, 'logistics'))) {
        const remaining = Math.max(0, d.carried - d.delivered);
        const n = deposit(dest, a.cargoKind, Math.min(remaining, s.cargo[a.cargoKind]));
        s.cargo[a.cargoKind] -= n;
        recordCargoTransfer(e,s.id,s.id,dest.id,a.cargoKind,n,'delivered',d);
        d.delivered += n;
        if (n > 0) {
          appendChat(
            e,
            d.actorId,
            COMMAND_CHANNEL,
            s.name + ' 实际卸货 ' + n + ' ' + a.cargoKind + ' 至 ' + dest.name,
            [],
            'report',
            { eventId: `${d.id}:${d.cycle}:unloaded:${d.delivered}` },
          );
          e.record(
            'cargo',
            s.name + ' 实际交付 ' + n + ' / ' + d.carried + ' ' + a.cargoKind + ' 至 ' + dest.name,
            dest.id,
            false,
          );
        }
        if (s.cargo[a.cargoKind] > 0 && d.delivered < d.carried) {
          d.note = '目的仓库已满，余货保留，等待仓位或改令';
          d.work = 0;
          return;
        }
        if (a.repeat) {
          agentOutcome(
            e,
            s,
            d,
            '实际交付 ' + d.delivered + ' ' + a.cargoKind + '，货损 ' + (d.lost ?? 0),
            (d.lost ?? 0) > 0 && d.delivered === 0,
            true,
          );
          d.cycle++;
          d.journey = null;
          d.phase = 'starting';
          d.work = 0;
          d.carried = 0;
          d.delivered = 0;
          d.lost = 0;
          s.path = [];
        } else
          e.complete(
            s,
            (d.lost ?? 0) > 0 ? '货损：实际交付 ' + d.delivered + '，损失 ' + d.lost : '交付完成',
            (d.lost ?? 0) > 0 && d.delivered === 0,
          );
      }
    }
  } else if (a.type === 'SHADOW') {
    const intel = w.intel.find((i) => i.id === a.targetId);
    if (!intel || intel.resolved) {
      e.complete(s, '跟踪目标已失效', true);
      return;
    }
    if (d.phase === 'starting') {
      if (SHIP_CLASSES[s.classId].cloak) s.cloak = 'on';
      d.phase = 'following';
    }
    if (!s.tracking || s.tracking.targetId !== a.targetId)
      s.tracking = {
        targetId: a.targetId,
        position: { x: intel.x, y: intel.y },
        lastSeen: intel.lastSeen,
        live: false,
      };
    const tracking = s.tracking!;
    const sensed = tracking.live && w.time - tracking.lastSeen < 2;
    if (sensed) d.search = 0;
    else {
      d.search += dt;
      if (d.search > RULES.searchMinutes) {
        e.complete(s, '跟踪失联：仅确认最后观测位置', true);
        return;
      }
    }
    go(
      e,
      s,
      d,
      tracking.position,
      dt,
      'direct',
      sensed ? Math.max(60, c.sensors * TRACKING_RULES.standOff) : 20,
    );
    if (s.current !== d) return;
    d.note = sensed
      ? s.cloak === 'on'
        ? '隐形被动尾随 / 低信号'
        : '普通尾随 / 存在暴露风险'
      : '搜索最后观测位置';
    const site = w.locations.find(
      (l) => l.owner !== 'starfleet' && l.discovered && dist(l, tracking.position) < 40,
    );
    if (sensed && site && Math.hypot(intel.velocity.x, intel.velocity.y) < 1) {
      e.record('tracking', '尾随与现场侦察确认目的地 ' + site.name, site.id);
      e.complete(s, '真实目的地已确认，可下达后续打击');
    }
  } else if (
    a.type === 'ATTACK' ||
    a.type === 'DISABLE' ||
    a.type === 'DRIVE_OFF' ||
    a.type === 'INTERCEPT'
  ) {
    const intel = w.intel.find((i) => i.id === a.targetId),
      facility = w.locations.find(
        (l) => l.id === a.targetId && l.discovered && l.owner !== 'starfleet',
      );
    if (intel?.resolved || facility?.hull === 0) {
      if (d.action.type === 'ATTACK_SET') finishSelectedTarget(e, s, d, '目标已确认摧毁', false);
      else e.complete(s, '目标已确认摧毁或解除');
      return;
    }
    if (!intel && !facility) {
      if (d.action.type === 'ATTACK_SET')
        finishSelectedTarget(e, s, d, '无法获得目标情报，未确认战果', true);
      else e.complete(s, '无法获得目标情报', true);
      return;
    }
    const sensed = intel?.live && w.time - intel.lastSeen < 2,
      p = facility ?? intel!;
    if (!sensed && !facility) {
      directiveFeedback(e, d, '目标失联，正在前往最后观测位置；尚未确认击毁。', 'lost-contact');
      if (w.time - intel!.lastSeen > RULES.intelTTL) {
        if (d.action.type === 'ATTACK_SET')
          finishSelectedTarget(e, s, d, '目标情报已过期，未确认战果', true);
        else e.complete(s, '目标情报已过期，未确认战果', true);
        return;
      }
      if (dist(s, p) <= 12) d.search += dt;
      d.note = '跟随最后观测位置；搜索接触';
      if (d.search > RULES.searchMinutes) {
        if (d.action.type === 'ATTACK_SET')
          finishSelectedTarget(e, s, d, '丢失接触，未确认战果', true);
        else e.complete(s, '丢失接触，未确认战果', true);
        return;
      }
    } else d.search = 0;
    const predicted =
      a.type === 'INTERCEPT' && intel
        ? { x: p.x + intel.velocity.x * 4, y: p.y + intel.velocity.y * 4 }
        : p;
    const range = sensed || facility ? 65 : 12;
    go(e, s, d, predicted, dt, 'direct', range);
    if (s.current !== d) return;
    const enemy = sensed ? w.enemies.find((x) => x.id === a.targetId) : undefined,
      target = facility ?? enemy;
    if (a.type === 'INTERCEPT') {
      d.note = 'Intercept / 根据观测速度迎击';
      if (sensed && dist(s, p) < 90) e.complete(s, '已截获接触；可攻击、驱离或继续 Shadow');
    } else if (target && dist(s, target) <= c.sensors) {
      if (s.weapons <= 0 || !SHIP_CLASSES[s.classId].weapons.length) {
        d.note = '武器系统不可用，无法开火；可立即维修、改令或接管';
        directiveFeedback(e, d, d.note, 'blocked-weapons');
        return;
      }
      d.note =
        dist(s, target) > 165
          ? '追击目标，尚未进入武器射程'
          : '攻击目标；射程、火控、能量及冷却由引擎结算';
      e.fire(
        s,
        target,
        a.type === 'DISABLE'
          ? (a.subsystem ?? 'suppression')
          : a.type === 'DRIVE_OFF'
            ? 'warning'
            : undefined,
      );
      if (a.type === 'DISABLE' && enemy && enemy[a.subsystem ?? 'engines'] <= 0)
        e.complete(s, '目标 ' + (a.subsystem ?? 'engines') + ' 已禁用');
      if (a.type === 'DRIVE_OFF' && enemy?.intent === 'retreat') e.complete(s, '已观测到目标撤退');
    }
  } else if (a.type === 'ESCORT') {
    const target = [...w.ships, ...w.civilians].find((x) => x.id === a.targetId);
    if (!target) {
      e.complete(s, '护航对象永久损失', true);
      return;
    }
    const contract = w.escortRequests.find(
      (r) => r.responderId === d.actorId && r.targetShipId === target.id && r.status === 'accepted',
    );
    if (
      !target.current &&
      (!contract || contract.started) &&
      !w.piracyIncidents.some((i) => i.shipId === target.id && i.stage !== 'resolved') &&
      dist(s, target) < 60 &&
      w.locations.some((l) => l.owner === 'starfleet' && l.hull > 0 && dist(target, l) < 40) &&
      (!('phase' in target) || target.phase !== 'delivery')
    ) {
      e.complete(s, '护航对象已安全抵港');
      return;
    }
    go(e, s, d, target, dt, undefined, 35);
    if (s.current !== d) return;
    d.note = 'Escort / ' + target.name;
    autonomousFire(e, s, target);
  } else if (a.type === 'PATROL') {
    const target = w.locations.find((l) => l.id === a.targetId && l.hull > 0);
    if (!target) {
      e.complete(s, '巡逻设施失效', true);
      return;
    }
    const angle = d.work * 0.1,
      p = { x: target.x + Math.cos(angle) * 55, y: target.y + Math.sin(angle) * 55 };
    go(e, s, d, p, dt, 'direct', 5);
    if (s.current !== d) return;
    if (dist(s, target) < 100) d.work += dt;
    autonomousFire(e, s, target);
    d.note = 'Patrol / ' + Math.floor(d.work) + ' / ' + a.duration;
    if (d.work >= a.duration) e.complete(s, '巡逻周期完成，真实设施存续');
  } else if (a.type === 'RECOVER') {
    const wreck = w.wrecks.find((x) => x.id === a.targetId && x.discovered);
    if (!wreck) {
      e.complete(s, '残骸不存在', true);
      return;
    }
    if (go(e, s, d, wreck, dt, 'direct', 8)) {
      let free = c.cargo - cargoUsed(s);
      for (const k of GOODS) {
        const n = Math.min(wreck.stock[k], Math.floor(free));
        wreck.stock[k] -= n;
        s.cargo[k] += n;
        recordCargoTransfer(e,s.id,wreck.id,s.id,k,n,'loaded',d);
        free -= n;
      }
      if (s.cargo.specialFinds > 0) unlockProductionDiscount(e);
      e.complete(s, '打捞实际残骸库存，货物留在舰上');
    }
  } else if (a.type === 'UNLOAD' && w.projects.some((p) => p.id === a.targetId)) {
    const dest = inventory(w, a.targetId);
    if (!dest) {
      e.complete(s, '卸货地点已失效', true);
      return;
    }
    if (go(e, s, d, dest, dt, 'safe', 8)) {
      for (const kind of GOODS) {const n=deposit(dest,kind,s.cargo[kind]);s.cargo[kind]-=n;recordCargoTransfer(e,s.id,s.id,dest.id,kind,n,'delivered',d);}
      e.complete(s, '真实货物已卸入建设项目');
    }
  } else if (arrivedService(e, s, d, dt)) {
    if (a.type === 'REST') {
      d.work += dt;
      d.note = '休息 / ' + d.work.toFixed(1) + ' / ' + a.duration;
      if (d.work + 1e-8 >= a.duration) {
        e.complete(s, '连续休息完成');
        if (!s.current) s.status = 'docked';
      }
    } else if (a.type === 'RETREAT' || a.type === 'DOCK') {
      e.complete(s, '停靠；货物保留');
      if (!s.current) s.status = 'docked';
    } else if (a.type === 'UNLOAD') {
      const dest = inventory(w, a.targetId)!;
      for (const k of GOODS) {
        const n = deposit(dest, k, s.cargo[k]);
        s.cargo[k] -= n;
        recordCargoTransfer(e,s.id,s.id,dest.id,k,n,'delivered',d);
      }
      e.record('cargo', s.name + ' 将实物货舱卸至 ' + dest.name, dest.id);
      if (cargoUsed(s) > 0) {
        d.note = '仓储已满，余货留舰，可改令';
        return;
      }
      e.complete(s, '货舱已入库');
    } else if (a.type === 'REPAIR') {
      const dest = inventory(w, a.targetId)!;
      if (s.hull >= c.hull && s.engines >= 100 && s.weapons >= 100) {
        e.complete(s, '维修完成');
        return;
      }
      const repair = Math.min(c.hull - s.hull, RULES.repairRate * dt),
        subsystem = Math.min(100 - s.engines, 4 * dt) + Math.min(100 - s.weapons, 4 * dt),
        price = (repair + subsystem) / RULES.repairPerMaterial;
      if (available(w, dest.id, 'materials') + 1e-8 < price) {
        d.note = '等待本地维修材料';
        return;
      }
      dest.stock.materials -= price;
      s.hull = Math.min(c.hull, s.hull + repair);
      s.engines = Math.min(100, s.engines + 4 * dt);
      s.weapons = Math.min(100, s.weapons + 4 * dt);
      d.note = 'Drydock / 实物维修';
    } else if (a.type === 'REARM') {
      const dest = inventory(w, a.targetId)!;
      if (d.phase === 'reserved') {
        d.phase = 'rearming';
        d.work = 0;
      }
      if (d.phase === 'starting') {
        if (
          available(w, dest.id, 'photon') < a.load.photon ||
          available(w, dest.id, 'quantum') < a.load.quantum
        ) {
          d.note = '等待实际弹药库存';
          return;
        }
        d.reserved.photon = a.load.photon;
        d.reserved.quantum = a.load.quantum;
        d.phase = 'rearming';
        d.work = 0;
      }
      d.work += dt;
      if (d.work >= RULES.torpedoLoadMinutes) {
        d.work = 0;
        const k = d.reserved.photon > 0 ? 'photon' : d.reserved.quantum > 0 ? 'quantum' : null;
        if (k) {
          if (dest.stock[k] < 1) {
            e.complete(s, '弹药库存失效', true);
            return;
          }
          dest.stock[k]--;
          s[k]++;
          d.reserved[k]--;
        }
        if (!d.reserved.photon && !d.reserved.quantum) e.complete(s, '装弹守恒完成');
      }
    } else if (a.type === 'REFIT') {
      if (d.phase === 'starting') {
        const valid = validateAction(e, s, a);
        if (!valid.ok) {
          e.complete(s, valid.reason, true);
          return;
        }
        const price = a.remove ? cost() : MODULES[a.moduleId].cost,
          dest = inventory(w, a.targetId)!;
        if (
          w.resources.credits < price.credits ||
          available(w, dest.id, 'materials') < price.materials ||
          available(w, dest.id, 'specialFinds') < price.specialFinds
        ) {
          d.note = '等待改装预算与现场库存';
          return;
        }
        w.resources.credits -= price.credits;
        dest.stock.materials -= price.materials;
        dest.stock.specialFinds -= price.specialFinds;
        d.paidCredits = price.credits;
        d.phase = 'refitting';
      }
      d.work += dt;
      d.note = 'Engineering / ' + MODULES[a.moduleId].label;
      if (d.work >= 10) {
        if (a.remove) s.modules = s.modules.filter((k) => k !== a.moduleId);
        else s.modules.push(a.moduleId);
        s.shield = Math.min(s.shield, capabilities(s).shield);
        e.record(
          'growth',
          s.name + ' ' + (a.remove ? '拆除' : '安装') + ' ' + MODULES[a.moduleId].label,
          s.id,
        );
        e.complete(s, '模块能力已改变下一轮活动');
      }
    }
  }
  if (
    w.ships.some((x) => x.id === s.id) &&
    s.current &&
    !['ATTACK', 'ATTACK_SET', 'DISABLE', 'DRIVE_OFF', 'SHADOW'].includes(s.current.action.type)
  )
    autonomousFire(e, s);
}
function finishSelectedTarget(
  e: SimulationEngine,
  s: Ship,
  d: Directive,
  text: string,
  failed: boolean,
) {
  if (d.action.type !== 'ATTACK_SET') return;
  const id = d.action.targetIds[d.targetIndex ?? 0];
  directiveFeedback(e, d, id + '：' + text + '；继续下一个选定目标。', 'target-result:' + id);
  if (failed) (d.unconfirmedTargets ??= []).push(id);
  else if (e.state.chatMessages.some((m) => m.eventId === `${d.id}:${d.cycle}:fired:${id}`))
    agentOutcome(e, s, d, text, false, true);
  d.targetIndex = (d.targetIndex ?? 0) + 1;
  d.cycle++;
  d.search = 0;
  d.journey = null;
  s.path = [];
  d.note = '切换下一个选定目标';
}
export function autonomousFire(e: SimulationEngine, s: Ship, protectedObject?: Point) {
  if (s.standing.roe === 'HOLD FIRE') return;
  const candidates = e.state.intel
    .filter((i) => i.live && !i.resolved && i.hostile && dist(s, i) < capabilities(s).sensors)
    .filter(
      (i) =>
        s.standing.roe === 'ENGAGE HOSTILES' ||
        s.lastAttackerId === i.id ||
        (protectedObject &&
          i.lastAttackTargetId === ('id' in protectedObject ? protectedObject.id : undefined)),
    );
  for (const i of candidates.sort((a, b) => dist(a, s) - dist(b, s) || a.id.localeCompare(b.id))) {
    const target = e.state.enemies.find((x) => x.id === i.id);
    if (target) {
      e.fire(s, target);
      break;
    }
  }
}
