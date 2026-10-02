import type { SimulationEngine } from './engine';
import type { Directive, Point, Ship } from './types';
import { GOODS } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { dist, move, planRoute } from './navigation';
import { regenerate } from './combat';
import { available, inventory, validateAction } from './command-system';
import { RULES } from './definitions/rules';
import { MODULES, cost } from './definitions/progression';
import { sectorCenter, materialize } from './world-generation';
import { regionAt } from './definitions/locations';
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
  route: 'safe' | 'direct' | 'risky' = 'direct',
  range = 6,
) {
  if (dist(s, p) <= range + 1) {
    s.path = [];
    return true;
  }
  const distance = dist(s, p),
    target = {
      x: p.x + ((s.x - p.x) * range) / distance,
      y: p.y + ((s.y - p.y) * range) / distance,
    };
  if (!s.path.length || dist(s.path[s.path.length - 1], target) > 25)
    s.path = planRoute(e.state, s, target, route);
  const factor =
    route === 'risky' ? 1.5 : route === 'safe' && e.state.upgrades.logistics ? 1.25 : 1;
  const previous = { x: s.x, y: s.y };
  if (s.path[0] && move(s, s.path[0], dt, factor)) s.path.shift();
  borderCrossing(e, s, previous);
  d.moved += dist(previous, s);
  d.note = '航行 / ' + route;
  if (route === 'risky') e.hit(s, 0.75 * dt * capabilities(s).hazardFactor);
  return dist(s, p) <= range + 1;
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
  return d.work >= ((RULES.surveyMinutes * 70) / Math.max(20, power)) * (close ? 1.3 : 1);
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
    e.state.resources.credits += 60;
    e.record('discovery', s.name + ' 发现 ' + sys.name + '，星图拨款 +60 Credits', sys.id);
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
  const d = s.current;
  if (!d) {
    if (
      s.standing.retreatHull > 0 &&
      (s.hull / capabilities(s).hull) * 100 < s.standing.retreatHull &&
      dist(s, e.base) > 30
    ) {
      move(s, e.base, dt);
      return;
    }
    autonomousFire(e, s);
    return;
  }
  const a = d.action,
    c = capabilities(s);
  if (a.type === 'MOVE') {
    if (go(e, s, d, a.point, dt)) e.complete(s, '抵达坐标');
  } else if (a.type === 'EXPLORE') {
    const close = a.approach === 'close',
      p = sectorCenter(a.sector);
    if (survey(e, s, d, p, dt, close, c.science, close ? 0.25 : 0)) {
      const sec = materialize(w, a.sector);
      const fresh = !sec.discovered;
      sec.discovered = true;
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
        if (tier === 2 && b.kind === 'anomaly' && !b.specialClaimed && cargoUsed(s) < c.cargo) {
          b.specialClaimed = true;
          s.cargo.specialFinds++;
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
    }
  } else if (a.type === 'MINE') {
    const b = w.bodies.find((b) => b.id === a.targetId),
      dest = inventory(w, a.unloadId);
    if (!b || !dest) {
      e.complete(s, '资源点或卸货设施失效；现有货物保留', true);
      return;
    }
    if (d.phase === 'unloading') {
      if (go(e, s, d, dest, dt, 'safe', 8)) {
        dest.stock.materials += s.cargo.materials;
        e.record(
          'cargo',
          s.name + ' 交付 ' + Math.floor(s.cargo.materials) + ' Materials 至 ' + dest.name,
          dest.id,
        );
        s.cargo.materials = 0;
        if (a.repeat && b.remaining > 0) {
          d.phase = 'extracting';
          d.work = 0;
          s.path = [];
        } else e.complete(s, '采集及卸货完成');
      }
    } else {
      if (b.remaining <= 0 || cargoUsed(s) >= c.cargo - 1e-8) {
        if (s.cargo.materials > 0) {
          d.phase = 'unloading';
          s.path = [];
        } else e.complete(s, '矿藏枯竭或货舱已满');
        return;
      }
      if (!go(e, s, d, b, dt, 'direct', 8)) return;
      const amount = Math.min(b.remaining, c.cargo - cargoUsed(s), c.mining * b.richness * dt);
      if (s.core < dt) {
        d.note = '能源恢复中';
        return;
      }
      b.remaining -= amount;
      s.cargo.materials += amount;
      s.core -= dt;
      d.work += dt;
      d.note =
        '采矿 ' +
        Math.floor(s.cargo.materials) +
        ' / ' +
        c.cargo +
        ' · 矿藏 ' +
        Math.floor(b.remaining);
      if (b.hazard > 0.4) e.hit(s, b.hazard * 0.1 * dt * c.hazardFactor);
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
      const amount = Math.min(a.amount, Math.floor(c.cargo - cargoUsed(s)));
      if (amount <= 0) {
        d.note = '货舱已满，请卸货或改令';
        return;
      }
      if (available(w, src.id, a.cargoKind) + 1e-8 < amount) {
        d.note = '等待起点实际库存 ' + amount + ' ' + a.cargoKind;
        return;
      }
      d.reserved[a.cargoKind] = amount;
      d.phase = 'loading';
      d.work = 0;
    }
    if (d.phase === 'loading') {
      if (!go(e, s, d, src, dt, a.route, 8)) return;
      d.work += dt;
      d.note = '装载真实货物';
      if (d.work >= RULES.loadMinutes) {
        const n = d.reserved[a.cargoKind];
        if (src.stock[a.cargoKind] + 1e-8 < n) {
          e.complete(s, '预留库存失效', true);
          return;
        }
        src.stock[a.cargoKind] -= n;
        s.cargo[a.cargoKind] += n;
        d.carried = n;
        d.reserved[a.cargoKind] = 0;
        d.phase = 'delivering';
        d.work = 0;
        s.path = [];
        e.record('cargo', s.name + ' 装载 ' + n + ' ' + a.cargoKind + '；真实航线启用', s.id);
      }
    } else if (d.phase === 'delivering') {
      if (!go(e, s, d, dest, dt, a.route, 8)) return;
      d.work += dt;
      d.note = '卸货至 ' + dest.name;
      if (d.work >= RULES.loadMinutes) {
        const n = Math.min(d.carried, s.cargo[a.cargoKind]);
        dest.stock[a.cargoKind] += n;
        s.cargo[a.cargoKind] -= n;
        d.delivered += n;
        e.record(
          'cargo',
          s.name + ' 实际交付 ' + n + ' / ' + d.carried + ' ' + a.cargoKind + ' 至 ' + dest.name,
          dest.id,
        );
        if (a.repeat) {
          d.phase = 'starting';
          d.work = 0;
          d.carried = 0;
          s.path = [];
        } else e.complete(s, n < d.carried ? '货损：仅交付现存货物' : '交付完成');
      }
    }
  } else if (
    a.type === 'ATTACK' ||
    a.type === 'DISABLE' ||
    a.type === 'DRIVE_OFF' ||
    a.type === 'INTERCEPT' ||
    a.type === 'SHADOW'
  ) {
    const intel = w.intel.find((i) => i.id === a.targetId),
      facility = w.locations.find(
        (l) => l.id === a.targetId && l.discovered && l.owner !== 'starfleet',
      );
    if (intel?.resolved || facility?.hull === 0) {
      e.complete(s, '目标已确认摧毁或解除');
      return;
    }
    if (!intel && !facility) {
      e.complete(s, '无法获得目标情报', true);
      return;
    }
    const sensed = intel?.live && w.time - intel.lastSeen < 2,
      p = facility ?? intel!;
    if (!sensed && !facility) {
      d.search += dt;
      d.note = '跟随最后观测位置；搜索接触';
      if (d.search > RULES.searchMinutes) {
        e.complete(s, '丢失接触，未确认战果', true);
        return;
      }
    } else d.search = 0;
    const predicted =
      a.type === 'INTERCEPT' && intel
        ? { x: p.x + intel.velocity.x * 4, y: p.y + intel.velocity.y * 4 }
        : p;
    const range = a.type === 'SHADOW' ? Math.min(120, Math.max(65, c.sensors * 0.5)) : 65;
    go(e, s, d, predicted, dt, 'direct', range);
    const enemy = sensed ? w.enemies.find((x) => x.id === a.targetId) : undefined,
      target = facility ?? enemy;
    if (a.type === 'SHADOW') {
      d.note = 'Shadow / 持续跟踪真实接触';
      if (enemy && enemy.intent === 'docked') {
        const home = w.locations.find((l) => l.id === enemy.homeId);
        if (home && dist(s, home) < c.sensors) {
          home.discovered = true;
          e.record('discovery', 'Shadow 追踪确认 ' + home.name, home.id);
          e.complete(s, '返航航迹确认 Hideout');
        }
      }
    } else if (a.type === 'INTERCEPT') {
      d.note = 'Intercept / 根据观测速度迎击';
      if (sensed && dist(s, p) < 90) e.complete(s, '已截获接触；可攻击、驱离或继续 Shadow');
    } else if (target && dist(s, target) <= c.sensors) {
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
    const target = w.ships.find((x) => x.id === a.targetId);
    if (!target) {
      e.complete(s, '护航对象永久损失', true);
      return;
    }
    if (!target.current && dist(target, e.base) < 40) {
      e.complete(s, '护航对象已安全抵港');
      return;
    }
    go(e, s, d, target, dt, 'direct', 35);
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
        free -= n;
      }
      e.complete(s, '打捞实际残骸库存，货物留在舰上');
    }
  } else if (arrivedService(e, s, d, dt)) {
    if (a.type === 'RETREAT' || a.type === 'DOCK') {
      e.complete(s, '停靠；货物保留');
      if (!s.current) s.status = 'docked';
    } else if (a.type === 'UNLOAD') {
      const dest = inventory(w, a.targetId)!;
      for (const k of GOODS) {
        dest.stock[k] += s.cargo[k];
        s.cargo[k] = 0;
      }
      e.record('cargo', s.name + ' 将实物货舱卸至 ' + dest.name, dest.id);
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
    !['ATTACK', 'DISABLE', 'DRIVE_OFF', 'SHADOW'].includes(s.current.action.type)
  )
    autonomousFire(e, s);
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
