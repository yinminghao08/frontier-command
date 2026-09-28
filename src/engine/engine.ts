import { FACTIONS } from './definitions/factions';
import { RESOURCE_DEFINITIONS } from './definitions/resources';
import { BASE, createWorld, WORLD_HEIGHT } from './data';
import { commandSchema } from './commands';
import type {
  AgentControllerPort,
  Command,
  CommandResult,
  Contact,
  LogEntry,
  Mission,
  Observation,
  Point,
  Ship,
  Snapshot,
  WorldState,
} from './types';

export const FIXED_DELTA = 0.1;
export const RANGE = 145;
export const SCAN_RANGE = 220;
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const ok = (reason = '命令已执行'): CommandResult => ({ ok: true, reason });
const no = (reason: string): CommandResult => ({ ok: false, reason });

export class SimulationEngine {
  state: WorldState;
  constructor(world = createWorld()) {
    this.state = structuredClone(world);
  }
  private random() {
    this.state.seed = (Math.imul(1664525, this.state.seed) + 1013904223) >>> 0;
    return this.state.seed / 4294967296;
  }
  log(text: string, level: LogEntry['level'] = 'info') {
    const w = this.state;
    w.logs.push({ id: w.nextLog++, time: w.time, level, text });
    if (w.logs.length > 180) w.logs.shift();
  }
  snapshot(): Snapshot {
    const { seed: _seed, nextIncursion: _incursion, ...view } = structuredClone(this.state);
    view.contacts = view.contacts
      .filter((c) => c.detected)
      .map((c) => (c.identified ? c : { ...c, name: '未识别亚空间接触' }));
    return view;
  }
  controllerPort(operatorId: string): AgentControllerPort {
    return Object.freeze({
      getObservation: () => this.getObservation(operatorId),
      dispatchCommand: (command: Command) =>
        this.state.operators.some((operator) => operator.id === operatorId)
          ? this.dispatchCommand(command, operatorId)
          : no('操作者不存在'),
    });
  }
  getObservation(operatorId: string): Observation | null {
    const operator = this.state.operators.find((o) => o.id === operatorId);
    const ship = operator && this.state.ships.find((s) => s.id === operator.shipId);
    if (!ship) return null;
    const candidates: Command[] = [
      { type: 'recall', shipId: ship.id },
      { type: 'scan', shipId: ship.id },
      { type: 'hold', shipId: ship.id },
      { type: 'repair', shipId: ship.id },
      { type: 'resume', shipId: ship.id },
      ...this.state.missions
        .filter((m) => m.phase === 'available')
        .map((m) => ({
          type: 'dispatch' as const,
          shipId: ship.id,
          missionId: m.id,
          route: 'safe' as const,
        })),
      ...this.state.contacts
        .filter((c) => c.detected)
        .flatMap((c) => [
          { type: 'hail' as const, shipId: ship.id, targetId: c.id },
          { type: 'engage' as const, shipId: ship.id, targetId: c.id },
        ]),
      { type: 'investigate', shipId: ship.id, choice: 'remote' },
      { type: 'route', shipId: ship.id, route: 'safe' },
    ];
    return structuredClone({
      time: this.state.time,
      operatorId,
      ship,
      contacts: this.snapshot().contacts,
      missions: this.state.missions,
      resources: this.state.resources,
      legalActions: [
        ...new Set(candidates.filter((c) => this.validate(c, operatorId).ok).map((c) => c.type)),
      ],
    });
  }
  validate(command: unknown, actorId = 'commander'): CommandResult {
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) return no('命令格式无效或包含越界数值');
    const c = parsed.data as Command,
      w = this.state;
    const isCommander = actorId === w.commander.id;
    const operator = w.operators.find((o) => o.id === actorId);
    if (!isCommander && !operator) return no('操作者不存在');
    if (
      !isCommander &&
      (!('shipId' in c) ||
        operator?.shipId !== c.shipId ||
        ['takeControl', 'releaseControl', 'helm'].includes(c.type))
    )
      return no('该操作者没有此命令权限');
    if (c.type === 'pause') return ok();
    if (c.type === 'speed')
      return w.manualShipId && c.speed !== 1 ? no('直接操舰期间固定为 1×') : ok();
    if (c.type === 'renew') {
      const m = w.missions.find((m) => m.id === c.missionId);
      if (
        !m ||
        !['complete', 'failed'].includes(m.phase) ||
        w.ships.some((s) => s.missionId === m.id)
      )
        return no('任务尚未结束或舰船尚未返航');
      return ok();
    }
    if (!('shipId' in c)) return no('未知命令');
    const s = w.ships.find((s) => s.id === c.shipId);
    if (!s) return no('舰船不存在');
    if (!isCommander && w.manualShipId === s.id)
      return no('指挥官已直接接管，该操作者暂时没有控制权');
    if (s.status === 'disabled') return no('舰船已失能，正在等待拖航');
    const m = w.missions.find((m) => m.id === s.missionId);
    if (c.type === 'dispatch') {
      const mission = w.missions.find((m) => m.id === c.missionId);
      if (!mission || mission.phase !== 'available') return no('任务不可派遣');
      if (s.status !== 'docked' || s.missionId || w.manualShipId === s.id)
        return no('舰船必须空闲停靠基地');
      if (s.hull < 35) return no('舰体低于 35%，请先维修');
      if (mission.kind === 'explore' && s.science < 40) return no('科学能力不足');
      if (mission.cargoRequired > s.capacity) return no('货舱容量不足');
      if (mission.cargoRequired > w.resources.supplies)
        return no('基地补给库存不足；每 180 秒获得常规补给');
    }
    if (
      c.type === 'repair' &&
      (s.status !== 'docked' || (s.hull >= 100 && s.shield >= s.maxShield))
    )
      return no('只有停靠且受损的舰船可以维修');
    if (c.type === 'takeControl' && (w.manualShipId || s.status === 'repairing'))
      return no('请先释放当前控制，或等待维修完成');
    if ((c.type === 'releaseControl' || c.type === 'helm') && w.manualShipId !== s.id)
      return no('未接管该舰');
    if (c.type === 'recall' && ['docked', 'repairing', 'returning'].includes(s.status))
      return no('舰船已在基地或正在返航');
    if (c.type === 'hold' && ['docked', 'repairing'].includes(s.status)) return no('舰船未出航');
    if (c.type === 'resume' && (s.order !== 'hold' || !m || m.settled))
      return no('没有可恢复的暂停任务');
    if (c.type === 'route' && (!m || m.kind !== 'supply' || m.settled || m.phase !== 'outbound'))
      return no('只能改变尚在去程的补给任务航线');
    if (c.type === 'investigate' && (!m || m.phase !== 'decision' || m.kind !== 'explore'))
      return no('当前没有等待处置的探索事件');
    if (
      c.type === 'scan' &&
      (s.status === 'repairing' ||
        !w.contacts.some((t) => !t.retreating && dist(s, t) <= SCAN_RANGE))
    )
      return no('扫描范围 220 内没有可分析的接触');
    if ('targetId' in c) {
      const target = w.contacts.find(
        (t) => t.id === c.targetId && t.detected && !t.retreating && t.hull > 0,
      );
      if (!target) return no('目标不可见、已失效或正在撤离');
      if (s.status === 'repairing') return no('维修期间不能执行战术命令');
      if (c.type === 'hail' && (!target.identified || dist(s, target) > 240))
        return no('请先识别目标并接近至 240 以内');
      if (c.type === 'engage' && !target.identified) return no('必须识别目标后才能交战');
    }
    if (c.type === 'fire') {
      if (w.paused) return no('模拟暂停期间不能开火');
      if (s.status === 'docked') return no('舰船停靠中，请先出港');
      const target = w.contacts.find((t) => t.id === s.targetId && t.detected && !t.retreating);
      if (!target || !target.identified) return no('请选择已识别的有效目标');
      if (s.status === 'repairing') return no('维修期间不能开火');
      if (s.cooldown > 0) return no('相位阵列冷却中');
      if (dist(s, target) > RANGE) return no('目标超出相位射程 145');
      if (Math.abs(angleDiff(Math.atan2(target.y - s.y, target.x - s.x), s.heading)) > Math.PI / 3)
        return no('目标不在舰艏 ±60° 射界内');
    }
    return ok();
  }
  dispatchCommand(command: unknown, actorId = 'commander'): CommandResult {
    const check = this.validate(command, actorId);
    if (!check.ok) return check;
    const c = command as Command,
      w = this.state;
    if (c.type === 'pause') {
      w.paused = c.paused;
      if (c.paused) this.clearInputs();
      return ok(c.paused ? '模拟已暂停' : '模拟已继续');
    }
    if (c.type === 'speed') {
      w.speed = c.speed;
      return ok(`模拟速度 ${c.speed}×`);
    }
    if (c.type === 'renew') {
      const m = w.missions.find((m) => m.id === c.missionId)!;
      Object.assign(m, {
        phase: 'available',
        shipId: null,
        started: 0,
        work: 0,
        decisionAt: 0,
        choice: null,
        settled: false,
        result: '',
        contactId: null,
        damage: 0,
        run: m.run + 1,
      });
      this.log(`行动窗口重新开放：${m.name}`);
      return ok();
    }
    if (!('shipId' in c)) return no('未知命令');
    const s = w.ships.find((s) => s.id === c.shipId)!;
    const m = w.missions.find((m) => m.id === s.missionId);
    switch (c.type) {
      case 'dispatch': {
        const task = w.missions.find((m) => m.id === c.missionId)!;
        Object.assign(task, { phase: 'outbound', shipId: s.id, route: c.route, started: w.time });
        Object.assign(s, {
          missionId: task.id,
          status: 'mission',
          order: 'mission',
          cargo: task.cargoRequired,
          targetId: null,
        });
        w.resources.supplies -= s.cargo;
        s.path = this.route(s, task);
        this.log(`${s.name} 接受 ${task.name}；${c.route === 'safe' ? '安全' : '快速'}航线。`);
        break;
      }
      case 'route':
        m!.route = c.route;
        s.path = this.route(s, m!);
        this.log(`${s.name} 改为${c.route === 'safe' ? '安全' : '快速'}航线。`);
        break;
      case 'investigate':
        this.investigate(s, m!, c.choice);
        break;
      case 'recall':
        if (m && !m.settled) this.settle(s, m, false, '指挥官召回，保留舰船与未交付货物');
        this.returnHome(s);
        this.log(`${s.name} 收到返航命令。`);
        break;
      case 'hold':
        this.clearManual(s);
        s.order = 'hold';
        s.path = [];
        s.throttle = 0;
        s.status = 'holding';
        this.log(`${s.name} 保持位置，任务时限仍在推进。`);
        break;
      case 'resume':
        this.clearManual(s);
        s.order = 'mission';
        s.status = 'mission';
        s.path = this.route(s, m!);
        this.log(`${s.name} 恢复原行动。`);
        break;
      case 'scan':
        this.scan(s);
        break;
      case 'target':
        s.targetId = c.targetId;
        break;
      case 'hail':
        this.hail(s, w.contacts.find((t) => t.id === c.targetId)!);
        break;
      case 'engage':
        this.clearManual(s);
        s.targetId = c.targetId;
        s.order = 'engage';
        s.status = 'mission';
        this.log(`${s.name} 正在自动拦截已识别接触。`, 'warning');
        break;
      case 'fire':
        this.fire(s, w.contacts.find((t) => t.id === s.targetId)!);
        break;
      case 'repair': {
        const cost = Math.ceil((100 - s.hull) / 5);
        s.emergency = w.resources.materials < cost;
        if (!s.emergency) w.resources.materials -= cost;
        s.status = 'repairing';
        s.repair = (100 - s.hull) / (s.emergency ? 0.5 : 2) + 10;
        this.log(
          `${s.name} 进入${s.emergency ? '基础抢修（无材料消耗）' : `标准维修（${cost} 材料）`}。`,
        );
        break;
      }
      case 'takeControl':
        w.manualShipId = s.id;
        w.speed = 1;
        s.helm = { turn: 0, throttle: 0 };
        s.throttle = 0;
        if (s.status === 'docked') s.status = 'holding';
        this.log(`指挥官直接接管 ${s.name}。自动驾驶暂停。`);
        break;
      case 'releaseControl':
        this.clearManual(s);
        if (c.resume && m && !m.settled) {
          s.order = 'mission';
          s.status = 'mission';
          s.path = this.route(s, m);
        } else if (c.resume && s.order === 'return') this.returnHome(s);
        else {
          s.order = 'hold';
          s.status = 'holding';
          s.path = [];
        }
        this.log(
          `${s.name} 已释放控制：${c.resume ? '恢复有效任务；无任务则保持位置' : '保持位置'}。`,
        );
        break;
      case 'helm':
        s.helm = { turn: c.turn, throttle: c.throttle };
        break;
    }
    return ok();
  }
  clearInputs() {
    for (const s of this.state.ships) s.helm = { turn: 0, throttle: 0 };
  }
  private clearManual(s: Ship) {
    if (this.state.manualShipId === s.id) this.state.manualShipId = null;
    s.helm = { turn: 0, throttle: 0 };
    s.throttle = 0;
  }
  private route(s: Ship, m: Mission): Point[] {
    const dest = this.state.locations.find((l) => l.id === m.locationId)!;
    if (m.kind === 'supply' && m.route === 'safe') {
      const waypoint = m.locationId === 'colony' ? { x: 290, y: 650 } : { x: 580, y: 430 };
      if (dist(s, dest) > dist(waypoint, dest) + 30) return [waypoint, { x: dest.x, y: dest.y }];
    }
    return [{ x: dest.x, y: dest.y }];
  }
  private returnHome(s: Ship) {
    this.clearManual(s);
    s.order = 'return';
    s.status = 'returning';
    s.targetId = null;
    s.path = [{ ...BASE }];
  }
  private scan(s: Ship) {
    let count = 0;
    for (const t of this.state.contacts) {
      if (!t.retreating && dist(s, t) <= SCAN_RANGE && !t.identified) {
        t.detected = true;
        t.identified = true;
        count++;
        this.state.resources.intel += FACTIONS[t.faction].scanIntel;
        this.log(`${s.name} 识别：${t.name}。${FACTIONS[t.faction].scanMessage}`, 'warning');
      }
    }
    if (!count) this.log(`${s.name} 扫描完成，未发现新的身份信息。`);
  }
  private hail(s: Ship, t: Contact) {
    t.detected = true;
    if (FACTIONS[t.faction].retreatOnWarning || s.power >= 12 || t.shield < 15 || t.hull < 60) {
      t.retreating = true;
      t.hostile = false;
      this.log(
        `${t.name} 接受警告，正在撤出边境。${FACTIONS[t.faction].warningMessage}`,
        'success',
      );
      this.resolveContact(t, '通过识别与警告完成驱离');
    } else {
      t.hostile = true;
      this.log(`${t.name} 拒绝弱势舰船的警告并转为敌对。可以撤离或请求巡逻舰支援。`, 'danger');
    }
  }
  private fire(s: Ship, t: Contact) {
    s.cooldown = 3;
    t.hostile = true;
    const shieldHit = Math.min(t.shield, s.power);
    t.shield -= shieldHit;
    t.hull = Math.max(0, t.hull - (s.power - shieldHit));
    this.state.beams.push({
      from: { x: s.x, y: s.y },
      to: { x: t.x, y: t.y },
      enemy: false,
      expires: this.state.time + 0.45,
    });
    if (t.hull <= 25) {
      t.retreating = true;
      t.hostile = false;
      this.log(`${t.name} 战斗失利，撤离接触区域。`, 'success');
      this.resolveContact(t, '通过战术拦截迫使目标撤离');
    }
  }
  private resolveContact(t: Contact, reason: string) {
    this.state.threat = Math.max(0, this.state.threat - 8);
    const m = this.state.missions.find((m) => m.id === t.missionId);
    if (m && !m.settled) {
      m.result = reason;
    }
  }
  private spawnContact(faction: Contact['faction'], p: Point, missionId: string | null) {
    if (this.state.contacts.filter((t) => !t.retreating).length >= 4) return null;
    const id = `contact-${this.state.nextContact++}`;
    const contact: Contact = {
      id,
      faction,
      name: FACTIONS[faction].contactName,
      x: p.x,
      y: p.y,
      detected: false,
      identified: false,
      hostile: false,
      shield: FACTIONS[faction].shield,
      hull: 80,
      retreating: false,
      missionId,
      cooldown: 0,
      created: this.state.time,
    };
    this.state.contacts.push(contact);
    return contact;
  }
  private investigate(s: Ship, m: Mission, choice: 'remote' | 'close') {
    m.choice = choice;
    m.phase = 'working';
    m.work = 0;
    if (choice === 'close') {
      const injury = Math.round(8 + this.random() * 25 * (1 - s.science / 130));
      m.damage += injury;
      this.damage(s, injury, true);
      this.log(
        `${s.name} 深入异常区：获得高分辨率样本，舰体受到 ${injury} 点辐射损伤。`,
        'warning',
      );
    } else this.log(`${s.name} 选择远距调查：保持安全距离，采用保守采样。`);
  }
  private settle(s: Ship, m: Mission, success: boolean, reason: string) {
    if (m.settled) return;
    m.settled = true;
    const r = this.state.resources;
    let gain = '';
    if (success) {
      if (m.kind === 'explore') {
        const data = Math.round(
          m.reward * (0.65 + s.science / 180) * (m.choice === 'close' ? 1.6 : 1),
        );
        r.science += data;
        gain = `科研数据 +${data}`;
      }
      if (m.kind === 'supply') {
        r.allocation += m.reward;
        const loc = this.state.locations.find((l) => l.id === m.locationId)!;
        loc.supply = Math.min(100, loc.supply + s.cargo);
        gain = `行动配额 +${m.reward}，交付 ${s.cargo} 补给`;
        s.cargo = 0;
      }
      if (m.kind === 'patrol') {
        r.allocation += m.reward;
        r.intel += 12;
        gain = `行动配额 +${m.reward}，巡逻情报 +12`;
      }
    } else {
      r.allocation = Math.max(0, r.allocation - 5);
      gain = '行动配额 -5；未交付货物返航回收';
    }
    m.result = `${success ? '成功' : '未完成'}：${reason}；${gain}。任务损伤 ${Math.round(m.damage)}。`;
    m.phase = success ? 'returning' : 'failed';
    this.log(`${m.name}｜${m.result}`, success ? 'success' : 'warning');
    this.returnHome(s);
  }
  private damage(s: Ship, amount: number, bypass = false) {
    const absorbed = bypass ? 0 : Math.min(s.shield, amount);
    s.shield -= absorbed;
    s.hull = Math.max(0, s.hull - amount + absorbed);
    if (s.hull <= 0 && s.status !== 'disabled') {
      const m = this.state.missions.find((m) => m.id === s.missionId);
      if (m && !m.settled) this.settle(s, m, false, '舰船失能，启动应急拖航');
      this.clearManual(s);
      s.status = 'disabled';
      s.path = [];
      s.tow = 35;
      this.log(`${s.name} 已失能，应急拖航将在 35 秒后将其送回基地。`, 'danger');
    }
  }
  private move(s: Ship, dest: Point, dt: number, multiplier = 1) {
    const d = dist(s, dest),
      step = s.speed * dt * multiplier;
    s.heading = Math.atan2(dest.y - s.y, dest.x - s.x);
    if (d <= step) {
      s.x = dest.x;
      s.y = dest.y;
      return true;
    }
    s.x += Math.cos(s.heading) * step;
    s.y += Math.sin(s.heading) * step;
    return false;
  }
  private dock(s: Ship) {
    const m = this.state.missions.find((m) => m.id === s.missionId);
    if (m?.phase === 'returning') m.phase = 'complete';
    this.state.resources.supplies += s.cargo;
    s.cargo = 0;
    s.missionId = null;
    s.order = 'hold';
    s.status = 'docked';
    s.path = [];
    s.throttle = 0;
    this.log(
      `${s.name} 已停靠曙光基地。${s.hull < 100 ? '建议安排维修。' : '等待下一项任务。'}`,
      'success',
    );
  }
  step(fixedDelta = FIXED_DELTA) {
    if (fixedDelta !== FIXED_DELTA) throw new Error('Simulation requires fixed 0.1 second steps');
    const w = this.state;
    if (w.paused) return;
    w.tick++;
    w.time = w.tick / 10;
    w.beams = w.beams.filter((b) => b.expires > w.time);
    if (w.tick % 1800 === 0) {
      w.resources.supplies = Math.min(
        RESOURCE_DEFINITIONS.supplies.resupplyCap,
        w.resources.supplies + RESOURCE_DEFINITIONS.supplies.resupplyAmount,
      );
      w.resources.materials = Math.min(
        RESOURCE_DEFINITIONS.materials.resupplyCap,
        w.resources.materials + RESOURCE_DEFINITIONS.materials.resupplyAmount,
      );
      this.log('Starfleet 常规补给到港：补给 +45，维修材料 +15。');
    }
    if (w.time >= w.nextIncursion) {
      const faction = this.random() < 0.5 ? 'klingon' : 'romulan';
      this.spawnContact(faction, { x: 910, y: 390 + this.random() * 200 }, null);
      w.nextIncursion = w.time + 180;
      w.threat = Math.min(100, w.threat + 6);
      this.log('边境传感器记录到亚空间扰动。派舰接近并扫描以确认。', 'warning');
    }
    for (const s of w.ships) {
      s.cooldown = Math.max(0, s.cooldown - fixedDelta);
      if (s.status === 'disabled') {
        s.tow -= fixedDelta;
        if (s.tow <= 0) {
          s.x = BASE.x;
          s.y = BASE.y;
          s.hull = 1;
          this.dock(s);
        }
        continue;
      }
      if (s.status === 'repairing') {
        s.repair -= fixedDelta;
        if (s.repair <= 0) {
          s.hull = 100;
          s.shield = s.maxShield;
          s.status = 'docked';
          this.log(`${s.name} 维修完毕。`, 'success');
        }
        continue;
      }
      if (s.status === 'docked') {
        s.shield = Math.min(s.maxShield, s.shield + fixedDelta * 3);
        continue;
      }
      const m = w.missions.find((m) => m.id === s.missionId);
      if (m && !m.settled && m.deadline && w.time - m.started > m.deadline)
        this.settle(s, m, false, '超过交付时限');
      if (w.manualShipId === s.id) {
        s.heading += s.helm.turn * 1.7 * fixedDelta;
        s.throttle = clamp(s.throttle + s.helm.throttle * fixedDelta * 0.7, 0, 1);
        s.x = clamp(s.x + Math.cos(s.heading) * s.speed * 2 * s.throttle * fixedDelta, 35, 1040);
        s.y = clamp(
          s.y + Math.sin(s.heading) * s.speed * 2 * s.throttle * fixedDelta,
          35,
          WORLD_HEIGHT - 35,
        );
      } else if (s.order === 'engage') {
        const t = w.contacts.find((t) => t.id === s.targetId && !t.retreating);
        if (t) {
          if (dist(s, t) > RANGE * 0.8) this.move(s, t, fixedDelta);
          else s.heading = Math.atan2(t.y - s.y, t.x - s.x);
          if (this.validate({ type: 'fire', shipId: s.id }).ok) this.fire(s, t);
        } else if (m && !m.settled) {
          s.order = 'mission';
          s.path = this.route(s, m);
        } else this.returnHome(s);
      } else if (s.order !== 'hold' && s.path.length) {
        const multiplier = m?.kind === 'supply' && m.route === 'fast' && !m.settled ? 1.25 : 1;
        if (this.move(s, s.path[0], fixedDelta, multiplier)) s.path.shift();
      }
      if (w.tick % 20 === 0) {
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 40) s.trail.shift();
      }
      if (s.order === 'return' && w.manualShipId !== s.id && dist(s, BASE) < 2) {
        this.dock(s);
        continue;
      }
      for (const t of w.contacts)
        if (!t.detected && dist(s, t) < FACTIONS[t.faction].detectionRange) {
          t.detected = true;
          this.log(`${s.name} 发现未识别接触。`, 'warning');
        }
      if (m && !m.settled && s.order !== 'hold') this.advanceMission(s, m, fixedDelta);
      if (w.manualShipId !== s.id && s.hull < 30 && m && !m.settled)
        this.settle(s, m, false, '舰体过低，默认安全规则触发撤离');
    }
    for (const t of w.contacts) {
      t.cooldown = Math.max(0, t.cooldown - fixedDelta);
      if (t.retreating) {
        t.x += fixedDelta * 12;
        continue;
      }
      if (t.hostile) {
        const victims = w.ships
          .filter((s) => !['disabled', 'docked', 'repairing'].includes(s.status))
          .sort((a, b) => dist(a, t) - dist(b, t));
        const s = victims[0];
        if (s && dist(s, t) < 280) {
          if (dist(s, t) > 120) {
            const a = Math.atan2(s.y - t.y, s.x - t.x);
            t.x += Math.cos(a) * 3 * fixedDelta;
            t.y += Math.sin(a) * 3 * fixedDelta;
          }
          if (dist(s, t) < RANGE && t.cooldown <= 0) {
            const damage = FACTIONS[t.faction].damage;
            t.cooldown = 4;
            const m = w.missions.find((m) => m.id === s.missionId);
            if (m && !m.settled) m.damage += Math.max(0, damage - s.shield);
            this.damage(s, damage);
            w.beams.push({
              from: { x: t.x, y: t.y },
              to: { x: s.x, y: s.y },
              enemy: true,
              expires: w.time + 0.45,
            });
            if (w.manualShipId !== s.id && s.status !== 'disabled' && s.order !== 'return') {
              s.targetId = t.id;
              s.order = 'engage';
            }
          }
        }
      }
      if (!t.missionId && w.time - t.created > 150) {
        t.retreating = true;
        this.log('边境接触离开本地传感器区域；未形成新的交战。');
      }
    }
    w.contacts = w.contacts.filter((t) => t.x < 1250);
  }
  private advanceMission(s: Ship, m: Mission, dt: number) {
    const w = this.state,
      loc = w.locations.find((l) => l.id === m.locationId)!;
    if (m.phase === 'outbound' && dist(s, loc) < 18) {
      m.phase = m.kind === 'explore' ? 'decision' : 'working';
      m.decisionAt = w.time;
      m.work = 0;
      this.log(
        `${s.name} 抵达 ${loc.name}。${m.kind === 'explore' ? '等待调查决策，20 秒后采用远距扫描。' : '开始执行任务。'}`,
      );
      if (m.kind === 'patrol') {
        const t = this.spawnContact(
          m.id === 'k7' ? 'klingon' : 'romulan',
          { x: loc.x + 65, y: loc.y - 20 },
          m.id,
        );
        if (t) {
          m.contactId = t.id;
          t.detected = true;
        }
      }
      if (m.kind === 'supply' && m.route === 'fast') {
        const loss = 4 + Math.floor(this.random() * 9);
        m.damage += loss;
        this.damage(s, loss, true);
        this.log(`${s.name} 快速航线穿越微陨石带，舰体损伤 ${loss}；货物完整。`, 'warning');
      }
    }
    if (m.phase === 'decision' && w.time - m.decisionAt >= 20) this.investigate(s, m, 'remote');
    if (m.phase !== 'working' || dist(s, loc) > 200) return;
    m.work += dt;
    if (m.kind === 'patrol') {
      if (!m.contactId) {
        const t = this.spawnContact(
          m.id === 'k7' ? 'klingon' : 'romulan',
          { x: loc.x + 65, y: loc.y - 20 },
          m.id,
        );
        if (t) {
          m.contactId = t.id;
          t.detected = true;
        }
      }
      const t = w.contacts.find((t) => t.id === m.contactId);
      if (w.manualShipId !== s.id && s.order === 'mission' && t && !t.retreating) {
        if (!t.identified && m.work >= 5) this.scan(s);
        if (t.identified && m.work >= 12 && !t.hostile) this.hail(s, t);
      }
      if (m.work >= m.duration && m.result) this.settle(s, m, true, m.result);
    } else if (m.work >= m.duration)
      this.settle(
        s,
        m,
        true,
        m.kind === 'explore'
          ? m.choice === 'close'
            ? '近距调查完成，样本精度提高'
            : '远距调查完成，保持安全距离'
          : `货物在 ${Math.round(w.time - m.started)} 秒内抵达，航线：${m.route === 'safe' ? '安全' : '快速'}`,
      );
  }
}
