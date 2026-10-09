import type { SimulationEngine } from '../engine';
import type { Action, Objective, Command, Ship } from '../types';
import { capabilities,cargoUsed } from '../capabilities';
import { available,inventory } from '../inventory';
import { dist } from '../navigation';
import { makeRequest,readyConditions,liveRequest } from '../contracts';
import { hasAdmiralWork } from '../fleet';
function report(e: SimulationEngine,objective: Objective,reason: string,status: Objective['status']) {e.runtime.transition(e.runtime.register(objective),status==='active'?'running':status,reason);}
function command(e: SimulationEngine, task: Objective, c: Command) {
  const root=e.runtime.register(task);return e.runtime.submitDirective(root.taskId,task.issuerId,c,root.revision);
}
function issue(e: SimulationEngine, task: Objective, ship: Ship, action: Action) { const result=e.runtime.issue(task,ship,action); if(!result.ok)report(e,task,'任务等待：'+result.reason,'blocked'); }

export function planTask(e: SimulationEngine, task: Objective) {
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
  if (task.goal.kind === 'cancel') {
    if (agent.assignedShipId)
      command(e, task, { type: 'cancelDirective', shipId: agent.assignedShipId });
    report(e, task, '指定舰船指令已取消，真实货物保留。', 'completed');
    return;
  }
  if (task.goal.kind === 'assignment') {
    const shipId=task.goal.shipId;
    const result = command(e, task, {
      type: 'assignAgent',
      agentId: agent.id,
      shipId: task.goal.shipId,
    });
    report(
      e,
      task,
      result.ok
        ? '舰船已实际分配：' + w.ships.find((s) => s.id === shipId)!.name
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
    ship.current?.objectiveId !== task.id
  ) {
    report(e, task, '任务等待：Admiral 直接指挥优先', 'blocked');
    return;
  }
  if (
    task.controlMode === 'voluntary' &&
    task.directiveMode === 'QUEUE' &&
    ship.current &&
    ship.current.objectiveId !== task.id &&
    ship.current.contractId !== task.id
  ) {
    report(e, task, '任务等待：已有行动，等待责任交接或当前任务完成', 'blocked');
    return;
  }
  if (
    w.ships.some((s) => [s.current, ...s.queue, ...s.suspended].some((d) => d?.objectiveId === task.id))
  )
    return;
  if (task.goal.kind === 'operation') {
    issue(e,task,ship,task.goal.action);
    return;
  }
  if (task.goal.kind === 'factionAssault') {
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
  if (task.goal.kind === 'surveyRoute') {
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
  if(task.goal.kind!=='construction')return;
  const kind=task.goal.facilityKind,siteId=task.goal.siteId;
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
    task.reason='项目已创建并支付 Credits，等待实际物资与施工';
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
          !w.objectives.some(
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
