import type { SimulationEngine } from './engine';
import type { Action, AdmiralTask, Command, Directive, Ship } from './types';
import { compileAdmiralIntent } from './admiral-intent';
import type { TaskIntent } from './admiral-intent';
import { appendChat, COMMAND_CHANNEL, privateChannel, remember, wakeAgent } from './chat';
import { capabilities, cargoUsed } from './capabilities';
import { available, haulLoad, inventory } from './inventory';
import { FACILITIES } from './definitions/progression';
import { dist, routeEstimate } from './navigation';
import { admiralTaskSchema } from './admiral-task-schema';
import {
  makeRequest,
  readyConditions,
  settleContract,
  liveRequest,
  cancelDescendants,
} from './contracts';
import { hasAdmiralWork } from './fleet';

export function addressedAdmiralMessage(e: SimulationEngine, agentId: string, messageId: number) {
  const w = e.state;
  return w.chatMessages.find(
    (m) =>
      m.id === messageId &&
      m.sender === w.commander.id &&
      (m.channelId === privateChannel(agentId) ||
        (m.channelId === COMMAND_CHANNEL && m.mentions.includes(agentId))),
  );
}
export function cancelAdmiralTasks(
  e: SimulationEngine,
  shipId: string | null,
  agentId?: string,
  stopExecution = true,
) {
  for (const task of e.state.admiralTasks.filter((t) => ['active', 'blocked'].includes(t.status))) {
    if (task.id === e.executingAdmiralTaskId) continue;
    const assigned = e.state.agents.find((a) => a.id === task.agentId)?.assignedShipId;
    const carrierShip = e.state.agents.find((a) => a.id === task.carrierAgentId)?.assignedShipId;
    if (
      task.agentId !== agentId &&
      task.carrierAgentId !== agentId &&
      (!shipId || (assigned !== shipId && carrierShip !== shipId))
    )
      continue;
    task.status = 'cancelled';
    task.reason = '新的 Admiral 指令接管';
    const ship = e.state.ships.find((s) => s.current?.taskId === task.id);
    if (ship?.current && stopExecution) e.complete(ship, task.reason, true);
    const a = e.state.agents.find((a) => a.id === task.agentId)!;
    a.decision.revision++;
    settleContract(e, task, false, task.reason, 'cancel');
    cancelDescendants(e, task.id);
    appendChat(
      e,
      a.id,
      task.channelId,
      '聊天任务后续步骤已取消：' +
        task.reason +
        (stopExecution ? '' : '；当前行动完成后执行新队列'),
      [],
      'reply',
      { origin: 'engine', replyTo: task.messageId, eventId: task.id + ':cancelled' },
    );
  }
}
function report(
  e: SimulationEngine,
  task: AdmiralTask,
  reason: string,
  status: AdmiralTask['status'],
) {
  if (task.status === status && task.reason === reason) return;
  task.status = status;
  task.reason = reason;
  const a = e.state.agents.find((a) => a.id === task.agentId)!;
  remember(e.state, a, 'outcome', reason, task.targetId, 8);
  appendChat(
    e,
    a.id,
    task.channelId,
    reason,
    [],
    status === 'failed' ? 'danger' : status === 'blocked' ? 'request' : 'reply',
    {
      origin: 'engine',
      replyTo: task.messageId,
      requestId: task.id,
      eventId: `${task.id}:${status}:${reason}`.slice(0, 160),
    },
  );
  if (status === 'completed') {
    if (task.kind === 'surveyRoute' || (task.kind === 'construction' && task.projectId !== null)) {
      a.experience += 10;
      a.skills.navigation = Math.min(100, a.skills.navigation + 0.8);
      a.morale = Math.min(100, a.morale + 2);
    }
    a.decision.revision++;
  }
}
export function receiveAdmiralTask(
  e: SimulationEngine,
  agentId: string,
  messageId: number,
  intent?: TaskIntent,
  directiveMode: 'REPLACE' | 'QUEUE' | 'INTERRUPT' = 'REPLACE',
) {
  const w = e.state,
    agent = w.agents.find((a) => a.id === agentId)!;
  const message = addressedAdmiralMessage(e, agentId, messageId)!;
  const direct =
    message.controlMode === 'direct' ||
    /^\s*(?:@[^\s]+\s+)?直接接管[，,:：\s]*/.test(message.content);
  const result = intent
    ? { intent, clarification: null }
    : compileAdmiralIntent(e.getObservation(agentId)!, {
        content: message.content.replace(/^\s*(?:@[^\s]+\s+)?直接接管[，,:：\s]*/, ''),
      });
  agent.decision.lastAdmiralMessageId = messageId;
  if (result.clarification) {
    appendChat(e, agentId, message.channelId, result.clarification, [], 'request', {
      origin: 'engine',
      replyTo: message.id,
    });
    if (direct && message.responses) message.responses[agentId] = 'replied';
    return;
  }
  if (!result.intent) return;
  const task: AdmiralTask = {
    ...result.intent,
    id: 'admiral-task-' + w.nextId,
    agentId,
    messageId,
    channelId: message.channelId,
    status: 'active',
    sectorIndex: 0,
    scannedSectorIndices: [],
    projectId: null,
    carrierAgentId: null,
    reason: null,
    controlMode:
      direct || ['assign', 'cancel'].includes(result.intent.kind) ? 'direct' : 'voluntary',
    consent: direct || ['assign', 'cancel'].includes(result.intent.kind) ? 'accepted' : 'proposed',
    conditions: [],
    conditionVersion: 1,
    rounds: 0,
    turnAgentId: agentId,
    creditsApproved: false,
    directiveMode,
    searchedTargets: {},
  };
  if (!admiralTaskSchema.safeParse(task).success) {
    if (direct && message.responses) message.responses[agentId] = 'replied';
    appendChat(
      e,
      agentId,
      message.channelId,
      '指令参数超出合法范围，请调整数量、时长或星区坐标。',
      [],
      'request',
      { origin: 'engine', replyTo: message.id },
    );
    return;
  }
  if (task.controlMode === 'direct') cancelAdmiralTasks(e, null, agentId);
  if (task.controlMode === 'direct' && message.responses) message.responses[agentId] = 'replied';
  w.nextId++;
  w.admiralTasks.push(task);
  agent.currentGoal = message.content.slice(0, 240);
  wakeAgent(agent, 'admiralChatTask', w.time, true);
  agent.decision.pendingReasons = [];
  agent.decision.events = [];
  if (task.consent === 'proposed') {
    wakeAgent(agent, 'proposal:' + task.id, w.time, true);
  }
  e.record(
    'admiralChatTask',
    'Admiral 聊天任务 / ' + agent.name + ' / message ' + messageId + ' / ' + task.kind,
    agentId,
    false,
  );
  advanceAdmiralTask(e, task);
}
export function proposeDirective(
  e: SimulationEngine,
  c: Extract<Command, { type: 'proposeDirective' }>,
) {
  for (const shipId of c.shipIds) {
    const agent = e.state.agents.find((a) => a.enabled && a.assignedShipId === shipId)!;
    const ship = e.state.ships.find((s) => s.id === shipId)!;
    const m = appendChat(
      e,
      e.state.commander.id,
      privateChannel(agent.id),
      `请 ${ship.name} 执行 ${c.action.type}：${'targetIds' in c.action ? c.action.targetIds.join(' → ') : 'targetId' in c.action ? c.action.targetId : '所选任务'}`,
      [],
      'message',
      { controlMode: 'voluntary' },
    );
    receiveAdmiralTask(
      e,
      agent.id,
      m.id,
      {
        kind: 'action',
        action: c.action,
        targetId: 'targetId' in c.action ? c.action.targetId : null,
        shipId: null,
        facilityKind: null,
        sectors: [],
        allowWormholes: true,
      },
      c.mode,
    );
  }
}
function command(e: SimulationEngine, task: AdmiralTask, c: Command) {
  const previous = e.executingAdmiralTaskId;
  e.executingAdmiralTaskId = task.id;
  try {
    return e.dispatchCommand(c);
  } finally {
    e.executingAdmiralTaskId = previous;
  }
}
function issue(e: SimulationEngine, task: AdmiralTask, ship: Ship, action: Action) {
  const result = command(
    e,
    task,
    ship.current && (task.directiveMode ?? 'REPLACE') === 'REPLACE'
      ? { type: 'modifyCurrentTask', shipId: ship.id, action }
      : {
          type: 'issueDirective',
          shipIds: [ship.id],
          mode: task.directiveMode ?? 'REPLACE',
          action,
        },
  );
  if (!result.ok) {
    report(e, task, '任务等待：' + result.reason, 'blocked');
    return;
  }
  task.status = 'active';
  task.reason = null;
  const a = e.state.agents.find((a) => a.id === task.agentId)!;
  a.status = task.controlMode === 'direct' ? 'admiral' : 'executing';
  let execution =
    action.type === 'ATTACK' || action.type === 'ATTACK_SET'
      ? '进入武器射程后实际开火，确认战果后处理下一目标。'
      : '由引擎执行，完成后报告。';
  if (action.type === 'HAUL') {
    const source = inventory(e.state, action.sourceId),
      destination = inventory(e.state, action.targetId);
    if (source && destination) {
      const carried = ship.current?.carried ?? 0;
      const extra = haulLoad(e.state, ship, action, carried);
      const arrival = routeEstimate(e.state, ship, source, action.route);
      const delivery = routeEstimate(
        e.state,
        { ...ship, x: source.x, y: source.y },
        destination,
        action.route,
      );
      const delivering = ship.current?.phase === 'delivering';
      execution = `路线 ${source.name} → ${destination.name}；现有 ${ship.cargo[action.cargoKind]} ${action.cargoKind}，预计补装 ${extra}（到场重新计算）。下一步：${delivering ? '直接交付现有货物' : dist(ship, source) <= 8 ? '在原起点补装，再送往原目的地' : '返回原起点补装，再送往原目的地'}。引擎预计 ${Math.ceil(delivering ? routeEstimate(e.state, ship, destination, action.route).eta : arrival.eta + delivery.eta - 4)} 游戏分钟。`;
    }
  }
  if (ship.current?.taskId !== task.id)
    execution = '任务已排入队列；开始执行时重新计算装载量和航线预计时间。';
  appendChat(
    e,
    a.id,
    task.channelId,
    'Admiral 命令已接受：' + ship.name + ' / ' + action.type + '。' + execution,
    [],
    'reply',
    {
      origin: 'engine',
      replyTo: task.messageId,
      eventId: task.id + ':issued:' + ('targetId' in action ? action.targetId : action.type),
    },
  );
}
export function advanceAdmiralTask(e: SimulationEngine, task: AdmiralTask) {
  if (!['active', 'blocked'].includes(task.status)) return;
  if (task.consent !== 'accepted') return;
  if (
    task.controlMode === 'voluntary' &&
    task.conditions.some((c) => c.type === 'reward') &&
    !task.creditsApproved
  ) {
    report(e, task, '等待 Admiral 确认奖励托管预算', 'blocked');
    return;
  }
  if (
    task.controlMode === 'voluntary' &&
    task.conditions.length &&
    !readyConditions(e, task, 'before')
  )
    return;
  const w = e.state,
    agent = w.agents.find((a) => a.id === task.agentId);
  if (!agent) return;
  if (task.kind === 'cancel') {
    if (agent.assignedShipId)
      command(e, task, { type: 'cancelDirective', shipId: agent.assignedShipId });
    report(e, task, '指定舰船指令已取消，真实货物保留。', 'completed');
    return;
  }
  if (task.kind === 'assign') {
    const result = command(e, task, {
      type: 'assignAgent',
      agentId: agent.id,
      shipId: task.shipId,
    });
    report(
      e,
      task,
      result.ok
        ? '舰船已实际分配：' + w.ships.find((s) => s.id === task.shipId)!.name
        : '分舰等待：' + result.reason + '，请明确是否解除原分配。',
      result.ok ? 'completed' : 'blocked',
    );
    return;
  }
  let ship = w.ships.find((s) => s.id === agent.assignedShipId);
  if (!ship) {
    report(e, task, '任务等待：尚未分配舰船，请先指定舰船。', 'blocked');
    return;
  }
  if (
    task.controlMode === 'voluntary' &&
    task.directiveMode === 'QUEUE' &&
    hasAdmiralWork(ship) &&
    ship.current?.taskId !== task.id
  ) {
    report(e, task, '任务等待：Admiral 直接指挥优先', 'blocked');
    return;
  }
  if (
    task.controlMode === 'voluntary' &&
    task.directiveMode === 'QUEUE' &&
    ship.current &&
    ship.current.taskId !== task.id &&
    ship.current.contractId !== task.id
  ) {
    report(e, task, '任务等待：已有行动，等待责任交接或当前任务完成', 'blocked');
    return;
  }
  if (
    w.ships.some((s) => [s.current, ...s.queue, ...s.suspended].some((d) => d?.taskId === task.id))
  )
    return;
  if (task.kind === 'action') {
    if (task.action) issue(e, task, ship, task.action);
    return;
  }
  if (task.kind === 'factionAssault') {
    const contacts = w.intel.filter(
      (i) =>
        i.factionId === 'orion' &&
        !i.resolved &&
        w.time - i.lastSeen <= 30 &&
        (task.searchedTargets?.[i.id] ?? -1) < i.lastSeen,
    );
    const targets = [
      ...contacts,
      ...w.locations.filter((l) => l.owner === 'orion' && l.discovered && l.hull > 0),
    ];
    targets.sort((l, r) => {
      const threat = (t: (typeof targets)[number]) =>
        'lastAttackAt' in t && t.lastAttackAt !== undefined && w.time - t.lastAttackAt <= 12
          ? 1
          : 0;
      const live = (t: (typeof targets)[number]) => ('live' in t ? Number(t.live) : 1);
      return (
        threat(r) - threat(l) ||
        live(r) - live(l) ||
        dist(ship!, l) - dist(ship!, r) ||
        l.id.localeCompare(r.id)
      );
    });
    if (!targets[0]) {
      report(e, task, '清剿保持中：暂无可攻击的已知 Orion 目标，等待新情报。', 'blocked');
      return;
    }
    task.targetId = targets[0].id;
    issue(e, task, ship, { type: 'ATTACK', targetId: targets[0].id });
    return;
  }
  if (task.kind === 'surveyRoute') {
    while (task.sectorIndex < task.sectors.length) {
      const coord = task.sectors[task.sectorIndex];
      const sector = w.sectors.find((s) => s.discovered && s.q === coord.q && s.r === coord.r);
      if (!sector || !task.scannedSectorIndices.includes(task.sectorIndex)) {
        issue(e, task, ship, { type: 'EXPLORE', sector: coord, approach: 'close' });
        return;
      }
      const systems = w.systems.filter((s) => s.discovered && s.sectorId === sector.id);
      const bodyIds = new Set(systems.flatMap((s) => s.bodyIds));
      const target = [
        ...systems,
        ...w.bodies.filter((b) => b.discovered && bodyIds.has(b.id)),
      ].find((t) => t.survey < 2);
      if (target) {
        issue(e, task, ship, {
          type: 'SURVEY',
          targetId: target.id,
          approach: 'close',
          deep: false,
        });
        return;
      }
      task.sectorIndex++;
    }
    report(e, task, '逐区测绘任务完成：所有指定星区已近距调查。', 'completed');
    return;
  }
  const kind = task.facilityKind!,
    siteId = task.targetId!;
  const facility = w.locations.find(
    (l) => l.siteId === siteId && l.kind === kind && l.owner === 'starfleet' && l.hull > 0,
  );
  if (facility) {
    report(e, task, '建设完成：' + facility.name + ' 已成为真实设施。', 'completed');
    return;
  }
  let project = w.projects.find((p) => p.siteId === siteId && p.kind === kind && !p.complete);
  if (!project) {
    const site = [...w.bodies, ...w.systems].find((s) => s.id === siteId && s.discovered);
    if (!site) {
      report(e, task, '建设等待：目标尚未发现。', 'blocked');
      return;
    }
    if (site.survey < 2) {
      issue(e, task, ship, { type: 'SURVEY', targetId: site.id, approach: 'close', deep: false });
      return;
    }
    const result = command(e, task, {
      type: 'startConstruction',
      siteId,
      kind,
      name: (site.name + ' / ' + kind.toUpperCase()).slice(0, 80),
    });
    if (!result.ok) {
      report(e, task, '建设等待：' + result.reason, 'blocked');
      return;
    }
    project = w.projects.find((p) => p.siteId === siteId && p.kind === kind && !p.complete)!;
    appendChat(
      e,
      agent.id,
      task.channelId,
      '建设项目已建立：' +
        project.name +
        '，已支付 ' +
        FACILITIES[kind].cost.credits +
        ' Credits；需要运输 ' +
        project.cost.materials +
        ' Materials。',
      [],
      'report',
    );
  }
  task.projectId = project.id;
  const need = Math.max(0, project.cost.materials - project.stock.materials);
  if (need < 1) {
    task.status = 'active';
    task.reason = '物资已到位，等待实际施工';
    return;
  }
  if (!task.carrierAgentId && capabilities(ship).cargo < need) {
    const peer = w.agents
      .filter(
        (a) =>
          a.id !== agent.id &&
          a.enabled &&
          a.personality.cooperation >= 40 &&
          a.fatigue < 80 &&
          !w.admiralTasks.some(
            (t) => t.agentId === a.id && ['active', 'blocked'].includes(t.status),
          ),
      )
      .sort(
        (left, right) =>
          right.skills.logistics - left.skills.logistics || left.id.localeCompare(right.id),
      )
      .map((a) => ({ a, ship: w.ships.find((s) => s.id === a.assignedShipId) }))
      .find(
        (p) =>
          p.ship &&
          !p.ship.current &&
          !p.ship.queue.length &&
          !p.ship.suspended.length &&
          capabilities(p.ship).cargo - cargoUsed(p.ship) >= need,
      );
    if (peer?.ship) {
      const previous = w.escortRequests.find(
        (r) => r.parentTaskId === task.id && r.kind === 'logistics',
      );
      if (!previous) {
        const source = w.locations
          .filter((l) => l.owner === 'starfleet' && available(w, l.id, 'materials') >= need)
          .sort((a, b) => dist(ship!, a) - dist(ship!, b))[0];
        if (source)
          makeRequest(
            e,
            agent.id,
            peer.a.id,
            'logistics',
            {
              type: 'HAUL',
              sourceId: source.id,
              targetId: project.id,
              cargoKind: 'materials',
              amount: need,
              loadPolicy: 'auto',
              route: 'safe',
              repeat: false,
            },
            null,
            [],
            task.id,
          );
      }
      const collaboration = w.escortRequests.find(
        (r) => r.parentTaskId === task.id && r.kind === 'logistics',
      );
      if (collaboration && liveRequest(collaboration)) {
        task.reason = '等待同僚自主接受或协商物流支援';
        return;
      }
      if (collaboration?.status === 'completed') task.carrierAgentId = collaboration.responderId;
    }
  }
  if (task.carrierAgentId) {
    const carrier = w.agents.find((a) => a.id === task.carrierAgentId);
    const assigned = w.ships.find((s) => s.id === carrier?.assignedShipId);
    if (!assigned) {
      report(e, task, '建设等待：物流同僚失去舰船，请重新分配或接管任务。', 'blocked');
      return;
    }
    ship = assigned;
  }
  if (ship.cargo.materials >= 1) {
    issue(e, task, ship, { type: 'UNLOAD', targetId: project.id });
    return;
  }
  if (cargoUsed(ship) >= capabilities(ship).cargo) {
    issue(e, task, ship, { type: 'UNLOAD', targetId: 'base' });
    return;
  }
  const source = w.locations
    .filter((l) => l.owner === 'starfleet' && l.hull > 0 && available(w, l.id, 'materials') >= 1)
    .sort((a, b) => dist(ship, a) - dist(ship, b) || a.id.localeCompare(b.id))[0];
  const amount = Math.floor(
    Math.min(
      need,
      capabilities(ship).cargo - cargoUsed(ship),
      source ? available(w, source.id, 'materials') : 0,
    ),
  );
  if (!source || amount < 1) {
    report(e, task, '建设等待：没有可运输的 Materials 或货舱空间不足。', 'blocked');
    return;
  }
  issue(e, task, ship, {
    type: 'HAUL',
    sourceId: source.id,
    targetId: project.id,
    cargoKind: 'materials',
    amount,
    loadPolicy: 'auto',
    route: 'safe',
    repeat: false,
  });
}
export function advanceAdmiralTasks(e: SimulationEngine) {
  if (e.state.tick % 10 !== 0) return;
  for (const task of e.state.admiralTasks) advanceAdmiralTask(e, task);
}
export function admiralTaskOutcome(
  e: SimulationEngine,
  directive: Directive,
  text: string,
  failed: boolean,
) {
  const task = e.state.admiralTasks.find((t) => t.id === directive.taskId);
  if (!task || task.status === 'cancelled') return;
  if (task.kind === 'factionAssault') {
    if (failed && task.targetId) {
      (task.searchedTargets ??= {})[task.targetId] =
        e.state.intel.find((i) => i.id === task.targetId)?.lastSeen ?? e.state.time;
    }
    task.status = 'active';
    task.reason = failed ? '未确认战果：' + text : '确认目标解除：' + text;
    appendChat(
      e,
      task.agentId,
      task.channelId,
      task.reason + '；继续处理其他已知目标。',
      [],
      'reply',
      { origin: 'engine', replyTo: task.messageId, eventId: directive.id + ':assault-outcome' },
    );
    return;
  }
  if (failed) {
    report(e, task, '任务实际失败：' + text, 'failed');
    settleContract(e, task, false, text);
    return;
  }
  if (
    task.kind === 'surveyRoute' &&
    directive.action.type === 'EXPLORE' &&
    !task.scannedSectorIndices.includes(task.sectorIndex)
  )
    task.scannedSectorIndices.push(task.sectorIndex);
  if (task.kind === 'action')
    report(
      e,
      task,
      'Admiral 聊天任务完成：' +
        text +
        ' · XP ' +
        Math.floor(e.state.agents.find((a) => a.id === task.agentId)!.experience),
      'completed',
    );
}
