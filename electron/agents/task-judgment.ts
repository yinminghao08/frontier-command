import { z } from 'zod';
import type { Observation } from '../../src/engine/types';
import { responseFields } from '../../src/engine/condition-schema';
import { protocolSchema } from '../../src/engine/decision-protocol';
import { capabilities } from '../../src/engine/capabilities';

export const taskJudgmentSchema = z
  .object({
    accept: z.boolean(),
    reason: responseFields.reason,
    rationale: z.string().trim().min(1).max(240),
    reply: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const taskJudgmentJsonSchema = protocolSchema(taskJudgmentSchema);
export const TASK_JUDGMENT_PROMPT = `TASK_JUDGMENT: 判断是否接受 Admiral 的这一个任务。只回复 JSON：{"accept":true,"reason":"preference","rationale":"简短原因","reply":"结合任务和性格对 Admiral 的简短答复"}。
依据所提供的性格、疲劳、现有工作、舰船能力、真实资源和公开风险判断。当前任务随时可以改变，接受新任务立即替换，运输修改继承起终点并保留已装货物；禁止宣称中途不能修改或擅自拖到下一趟。reason 只能选 risk/fatigue/damage/conflict/preference/relationship/promise。接受或拒绝，不协商条件，不生成动作。reply 说明打算如何执行或真实拒绝理由，不反复道歉，不虚构已完成操作或预计时间。`;

/** Only public facts relevant to this task, never the complete world or decision protocol. */
export function taskJudgmentContext(o: Observation) {
  const task = o.objective;
  if (!task || !o.self) throw Error('No task to judge');
  const ids = new Set([task.targetId, task.shipId]);
  if (task.action) {
    if ('targetId' in task.action) ids.add(task.action.targetId);
    if ('sourceId' in task.action) ids.add(task.action.sourceId);
    if (task.action.type === 'ATTACK_SET') for (const id of task.action.targetIds) ids.add(id);
  }
  const ship = o.ship,
    a = o.self;
  const c = ship ? capabilities(ship) : null;
  const context = {
    task: { ...task, reason: task.reason?.slice(0, 240) ?? null },
    instruction: o.recentChat.find((m) => m.id === task.messageId)?.content ?? a.currentGoal,
    self: {
      id: a.id,
      name: a.name,
      personality: a.personality,
      profile: a.profile,
      fatigue: a.fatigue,
      morale: a.morale,
      trust: a.trust,
      psychology: a.psychology,
      skills: a.skills,
      taskPreferences: a.taskPreferences,
    },
    ship:
      ship && c
        ? {
            id: ship.id,
            classId: ship.classId,
            x: ship.x,
            y: ship.y,
            hullPercent: (ship.hull / c.hull) * 100,
            shieldPercent: (ship.shield / c.shield) * 100,
            corePercent: (ship.core / c.core) * 100,
            photon: ship.photon,
            quantum: ship.quantum,
            cargo: ship.cargo,
            capacity: c.cargo,
            modules: ship.modules,
            current: ship.current?.action ?? null,
            queue: ship.queue.slice(0, 2).map((d) => d.action),
            suspended: ship.suspended.slice(0, 2).map((d) => d.action),
            carried: o.currentTask?.carried ?? 0,
          }
        : null,
    decisionContext: {
      willingness: o.decisionContext.willingness,
      riskLimit: o.decisionContext.riskLimit,
      conflicts: o.decisionContext.conflicts,
    },
    targetCount: ids.size,
    targets: [...o.locations, ...o.systems, ...o.bodies, ...o.projects, ...o.contacts]
      .filter((t) => ids.has(t.id))
      .map((t) => ({
        id: t.id,
        name: t.name,
        x: t.x,
        y: t.y,
        ...('hull' in t ? { hull: t.hull } : {}),
        ...('owner' in t ? { owner: t.owner } : {}),
        ...('factionId' in t
          ? { factionId: t.factionId, live: t.live, hostile: t.hostile, lastSeen: t.lastSeen }
          : {}),
      })),
    inventories: o.inventories.filter((i) => ids.has(i.locationId)),
    constructionOptions: o.constructionOptions.filter(
      (c) => c.siteId === task.targetId && c.kind === task.facilityKind,
    ),
    threats: o.contacts
      .filter(
        (i) =>
          i.live &&
          i.hostile &&
          !i.resolved &&
          (ids.has(i.id) || (ship && Math.hypot(i.x - ship.x, i.y - ship.y) < 240)),
      )
      .slice(0, 6),
    company: { credits: o.company.credits, tension: o.company.tension },
  };
  const tooLarge = () => Buffer.byteLength(JSON.stringify(context)) > 8200;
  for (const key of ['constructionOptions', 'threats', 'targets', 'inventories'] as const)
    while (tooLarge() && context[key].length) context[key].pop();
  if (tooLarge()) context.task.sectors = [...task.sectors.slice(0, 2), ...task.sectors.slice(-1)];
  if (tooLarge() && context.task.action?.type === 'ATTACK_SET')
    context.task.action = {
      ...context.task.action,
      targetIds: context.task.action.targetIds.slice(0, 12),
    };
  return context;
}
