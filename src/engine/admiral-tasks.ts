import type { SimulationEngine } from './engine';
import type { Action, AdmiralTask, Command, Directive, Ship } from './types';
import { compileAdmiralIntent } from './admiral-intent';
import { appendChat, COMMAND_CHANNEL, privateChannel, remember, wakeAgent } from './chat';
import { capabilities, cargoUsed } from './capabilities';
import { available } from './inventory';
import { FACILITIES } from './definitions/progression';
import { dist } from './navigation';
import { admiralTaskSchema } from './admiral-task-schema';

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
    wakeAgent(a, 'admiralTaskCancelled', e.state.time, true);
    appendChat(
      e,
      a.id,
      task.channelId,
      '聊天任务后续步骤已取消：' +
        task.reason +
        (stopExecution ? '' : '；当前行动完成后执行新队列'),
      [],
      'report',
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
  appendChat(e, a.id, task.channelId, reason, [], status === 'blocked' ? 'request' : 'report');
  if (status === 'completed') {
    if (task.kind === 'surveyRoute' || (task.kind === 'construction' && task.projectId !== null)) {
      a.experience += 10;
      a.skills.navigation = Math.min(100, a.skills.navigation + 0.8);
      a.morale = Math.min(100, a.morale + 2);
    }
    wakeAgent(a, 'admiralTaskCompleted', e.state.time, true);
  }
}
export function receiveAdmiralTask(e: SimulationEngine, agentId: string, messageId: number) {
  const w = e.state,
    agent = w.agents.find((a) => a.id === agentId)!;
  const message = addressedAdmiralMessage(e, agentId, messageId)!;
  const result = compileAdmiralIntent(e.getObservation(agentId)!, message);
  agent.decision.lastAdmiralMessageId = messageId;
  if (result.clarification) {
    appendChat(e, agentId, message.channelId, result.clarification, [], 'request');
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
  };
  if (!admiralTaskSchema.safeParse(task).success) {
    appendChat(
      e,
      agentId,
      message.channelId,
      '指令参数超出合法范围，请调整数量、时长或星区坐标。',
      [],
      'request',
    );
    return;
  }
  cancelAdmiralTasks(e, null, agentId);
  w.nextId++;
  w.admiralTasks.push(task);
  agent.currentGoal = message.content.slice(0, 240);
  wakeAgent(agent, 'admiralChatTask', w.time, true);
  agent.decision.pendingReasons = [];
  e.record(
    'admiralChatTask',
    'Admiral 聊天任务 / ' + agent.name + ' / message ' + messageId + ' / ' + task.kind,
    agentId,
    false,
  );
  advanceAdmiralTask(e, task);
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
  const result = command(e, task, {
    type: 'issueDirective',
    shipIds: [ship.id],
    mode: 'REPLACE',
    action,
  });
  if (!result.ok) {
    report(e, task, '任务等待：' + result.reason, 'blocked');
    return;
  }
  task.status = 'active';
  task.reason = null;
  const a = e.state.agents.find((a) => a.id === task.agentId)!;
  a.status = 'admiral';
  appendChat(
    e,
    a.id,
    task.channelId,
    'Admiral 命令已接受：' +
      ship.name +
      ' / ' +
      action.type +
      '。' +
      (action.type === 'ATTACK'
        ? '跟踪公开接触，进入武器射程后开火。'
        : '由引擎执行，完成后报告。'),
    [],
    'report',
  );
}
export function advanceAdmiralTask(e: SimulationEngine, task: AdmiralTask) {
  if (!['active', 'blocked'].includes(task.status)) return;
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
    w.ships.some((s) => [s.current, ...s.queue, ...s.suspended].some((d) => d?.taskId === task.id))
  )
    return;
  if (task.kind === 'action') {
    if (task.action) issue(e, task, ship, task.action);
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
          a.career === 'logistics' &&
          a.personality.cooperation >= 40 &&
          a.fatigue < 80 &&
          !w.admiralTasks.some(
            (t) => t.agentId === a.id && ['active', 'blocked'].includes(t.status),
          ),
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
      task.carrierAgentId = peer.a.id;
      appendChat(
        e,
        agent.id,
        COMMAND_CHANNEL,
        '@' + peer.a.name + ' 请求运送建设物资：' + project.name + ' / ' + need + ' Materials。',
        [peer.a.id],
        'request',
      );
      appendChat(
        e,
        peer.a.id,
        COMMAND_CHANNEL,
        '@' + agent.name + ' 已接受此 Admiral 建设任务的物流协作，将提交真实 HAUL。',
        [agent.id],
        'reply',
        { purpose: 'acknowledgement' },
      );
      for (const [a, other] of [
        [agent, peer.a],
        [peer.a, agent],
      ]) {
        const relationship = a.relationships[other.id];
        if (relationship) {
          relationship.cooperation = Math.min(100, relationship.cooperation + 4);
          relationship.lastInteraction = w.time;
        }
        remember(w, a, 'decision', '建设物资协作已接受', other.id, 6);
      }
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
  if (failed) {
    report(e, task, '任务中断：' + text, 'blocked');
    return;
  }
  if (
    task.kind === 'surveyRoute' &&
    directive.action.type === 'EXPLORE' &&
    !task.scannedSectorIndices.includes(task.sectorIndex)
  )
    task.scannedSectorIndices.push(task.sectorIndex);
  if (task.kind === 'action') report(e, task, 'Admiral 聊天任务完成：' + text, 'completed');
}
