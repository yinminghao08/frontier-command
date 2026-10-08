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
  })
  .strict();
export const taskJudgmentJsonSchema = protocolSchema(taskJudgmentSchema);
export const TASK_JUDGMENT_PROMPT = `TASK_JUDGMENT: 判断是否接受 Admiral 的这一个任务。只回复 JSON：{"accept":true,"reason":"preference","rationale":"简短原因"}。
依据所提供的性格、疲劳、现有工作、舰船能力、真实资源和公开风险自行判断。reason 只能选 risk/fatigue/damage/conflict/preference/relationship/promise。接受或拒绝即可，不协商条件，不生成行动、消息、记忆或后续计划。rationale 一句话，不超过240字。不得虚构执行结果。`;

/** Only public facts relevant to this task, never the complete world or decision protocol. */
export function taskJudgmentContext(o: Observation) {
  const task = o.admiralTask;
  if (!task || !o.self) throw Error('No task to judge');
  const ids = new Set([task.targetId, task.shipId]);
  if (task.action) {
    if ('targetId' in task.action) ids.add(task.action.targetId);
    if ('sourceId' in task.action) ids.add(task.action.sourceId);
  }
  const ship = o.ship,
    a = o.self;
  const c = ship ? capabilities(ship) : null;
  return {
    task,
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
            queue: ship.queue.map((d) => d.action),
            suspended: ship.suspended.map((d) => d.action),
          }
        : null,
    decisionContext: {
      willingness: o.decisionContext.willingness,
      riskLimit: o.decisionContext.riskLimit,
      conflicts: o.decisionContext.conflicts,
    },
    targets: [...o.locations, ...o.systems, ...o.bodies, ...o.projects, ...o.contacts].filter((t) =>
      ids.has(t.id),
    ),
    inventories: o.inventories.filter((i) => ids.has(i.locationId)),
    constructionOptions: o.constructionOptions.filter(
      (c) => c.siteId === task.targetId && c.kind === task.facilityKind,
    ),
    threats: o.contacts.filter(
      (i) =>
        i.live &&
        i.hostile &&
        !i.resolved &&
        (ids.has(i.id) || (ship && Math.hypot(i.x - ship.x, i.y - ship.y) < 240)),
    ),
    company: { credits: o.company.credits, tension: o.company.tension },
  };
}
