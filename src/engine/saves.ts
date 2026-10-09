import { assignmentView, bindAssignment } from './assignment';
import { z } from 'zod';
import { worldSchema } from './save-schema';
import type { WorldState, Objective } from './types';
import { worldSchema as v14Schema } from './legacy-v14/save-schema';
import { worldSchema as v15Schema } from './legacy-v15/save-schema';
import { freshAgentDynamics } from './definitions/agents';
import { createTask, criterionFor, freshRuntime, type ObjectiveGoal } from './agent-runtime/model';
function restoreAssignments(world: z.infer<typeof worldSchema>): WorldState {
  const agents = world.agents.map((agent) => assignmentView(world, agent));
  const restored = { ...world, agents };
  for (const agent of agents) bindAssignment(restored, agent);
  return restored;
}
export const CURRENT_SAVE_VERSION = 16;
export class UnsupportedSaveVersionError extends Error {}
/** Frozen validation precedes migration. No inventory, XP or reward is replayed. */
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 14) {
    const old = v14Schema.parse(input);
    return parseSave({
      ...old,
      version: 15,
      agents: old.agents.map((a) => ({
        ...a,
        stateDynamics: {
          ...freshAgentDynamics(),
          thresholds: [
            ...(a.fatigue >= 50 ? ['fatigue50'] : []),
            ...(a.fatigue >= 80 ? ['fatigue80'] : []),
            ...(a.psychology.stress >= 60 ? ['stress60'] : []),
            ...(a.psychology.resentment >= 50 ? ['resentment50'] : []),
          ],
        },
      })),
    });
  }
  if (version === 15) {
    const old = v15Schema.parse(input);
    const { admiralTasks, ...base } = old;
    const agentRuntime = freshRuntime();
    const objectives: Objective[] = admiralTasks.map((previous) => {
      const {
        salvage,
        sectorIndex,
        scannedSectorIndices,
        projectId,
        carrierAgentId,
        searchedTargets,
        ...t
      } = previous;
      let goal: ObjectiveGoal;
      if (t.kind === 'salvage' && salvage)
        goal = {
          kind: 'recovery',
          wreckIds: salvage.wreckIds,
          sourceClassId: null,
          includeDiscoveries: false,
          destinationId: salvage.destinationId,
          cargoKind: 'materials',
        };
      else if (t.kind === 'surveyRoute') goal = { kind: 'surveyRoute', sectors: t.sectors };
      else if (t.kind === 'construction' && t.targetId && t.facilityKind)
        goal = { kind: 'construction', siteId: t.targetId, facilityKind: t.facilityKind };
      else if (t.kind === 'factionAssault') goal = { kind: 'factionAssault', factionId: 'orion' };
      else if (t.kind === 'assign' && t.shipId) goal = { kind: 'assignment', shipId: t.shipId };
      else if (t.kind === 'cancel') goal = { kind: 'cancel' };
      else if (t.action) goal = { kind: 'operation', action: t.action };
      else throw Error('Legacy objective has no provable parameters');
      const message = old.chatMessages.find((m) => m.id === t.messageId)!;
      const objective: Objective = {
        ...t,
        goal,
        schemaVersion: 1,
        originInteractionId: `interaction:${t.messageId}:${t.agentId}`,
        issuerId: old.commander.id,
        ownerAgentId: t.agentId,
        constraints: { allowWormholes: t.allowWormholes },
        completionCriteria: criterionFor(goal),
        revision: 0,
        createdAt: message.time,
        updatedAt: old.time,
        originalInstruction: message.content,
        amendments: [],
      };
      const task = createTask(
        objective,
        old.assignments.find((a) => a.operatorId === t.agentId)?.shipId ?? t.shipId,
      );
      task.execution = {
        sectorIndex,
        scannedSectorIndices,
        projectId,
        carrierAgentId,
        selectedTargetId: t.kind === 'factionAssault' ? t.targetId : null,
        searchedTargets: searchedTargets ?? {},
      };
      if (task.status === 'completed') {
        task.status = 'completed_partial';
        objective.status = 'completed_partial';
        task.blockReason = '旧存档保留完成记录；缺少完整目标证据';
      }
      task.progress.legacyUnknown = t.kind === 'salvage';
      agentRuntime.tasks.push(task);
      agentRuntime.interactions.push({
        interactionId: objective.originInteractionId,
        source: 'chat',
        senderId: old.commander.id,
        recipientAgentId: t.agentId,
        sourceMessageId: t.messageId,
        instruction: message.content,
        authorizationMode: t.controlMode,
        objectiveId: t.id,
        phase: 'committed',
        createdAt: message.time,
      });
      return objective;
    });
    const ships = base.ships.map((ship) => {
      const migrateDirective = (
        d: typeof ship.current,
        placement: 'current' | 'queue' | 'suspended',
      ) => {
        if (!d) return null;
        let task = d.taskId
          ? agentRuntime.tasks.find((t) => t.objectiveId === d.taskId)
          : undefined;
        let objective = task ? objectives.find((o) => o.id === task!.objectiveId) : undefined;
        if (!task || !objective) {
          const owner = d.executorAgentId ?? (d.source === 'agent' ? d.actorId : null);
          const source = old.chatMessages.find(
            (m) =>
              m.id === d.sourceMessageId &&
              m.sender === old.commander.id &&
              owner !== null &&
              (m.channelId === 'private:' + owner || m.mentions.includes(owner)),
          );
          const goal: ObjectiveGoal = { kind: 'operation', action: structuredClone(d.action) },
            id = 'legacy-objective:' + d.id;
          objective = {
            id,
            schemaVersion: 1,
            originInteractionId: 'legacy-interaction:' + d.id,
            issuerId: d.actorId,
            ownerAgentId: owner,
            goal,
            constraints: { allowWormholes: d.allowWormholes },
            completionCriteria: criterionFor(goal),
            revision: 0,
            createdAt: d.created,
            updatedAt: old.time,
            originalInstruction: source?.content ?? 'Legacy directive: ' + d.action.type,
            amendments: [],
            agentId: owner ?? old.commander.id,
            messageId: source?.id ?? 0,
            channelId: source?.channelId ?? 'system-reports',
            kind: 'action',
            action: structuredClone(d.action),
            targetId: null,
            shipId: ship.id,
            facilityKind: null,
            sectors: [],
            allowWormholes: d.allowWormholes,
            reason: null,
            controlMode: d.controlMode,
            consent: 'accepted',
            conditions: [],
            conditionVersion: 1,
            rounds: 0,
            turnAgentId: owner ?? old.commander.id,
            creditsApproved: false,
            directiveMode: placement === 'queue' ? 'QUEUE' : 'REPLACE',
            status: 'active',
          };
          objectives.push(objective);
          task = createTask(objective, ship.id);
          agentRuntime.tasks.push(task);
          agentRuntime.interactions.push({
            interactionId: objective.originInteractionId,
            source: source ? 'chat' : 'ui',
            senderId: d.actorId,
            recipientAgentId: owner,
            sourceMessageId: source?.id ?? null,
            instruction: objective.originalInstruction,
            authorizationMode: objective.controlMode,
            objectiveId: id,
            phase: 'committed',
            createdAt: d.created,
          });
        }
        const migrated = {
          ...d,
          taskId: task.taskId,
          objectiveId: objective.id,
          originInteractionId: objective.originInteractionId,
          submissionKey: 'legacy:' + d.id,
        };
        task.coordinationId = d.contractId;
        task.directiveIds.push(d.id);
        task.steps.push({
          label: d.action.type,
          action: structuredClone(d.action),
          status: placement === 'queue' ? 'pending' : 'running',
        });
        task.submissionKeys[migrated.submissionKey] = d.id;
        if (placement === 'current') {
          task.activeDirectiveId = d.id;
          task.status = 'running';
        }
        if (d.action.type === 'HAUL') {
          task.progress.cycles = d.cycle;
          task.progress.loaded[d.action.cargoKind] += d.carried;
          task.progress.delivered[d.action.cargoKind] += d.delivered;
          task.progress.lost[d.action.cargoKind] += d.lost ?? 0;
        }
        // Preserve OpenRA-style direct queues. A displaced Agent commitment needs
        // explicit restoration under FAR instead of silently restarting on load.
        if (placement === 'suspended' && d.controlMode !== 'direct') {
          task.checkpoint = migrated;
          task.status = 'interrupted';
          task.activeDirectiveId = null;
          task.blockReason = '旧 Agent 目标已中断，等待显式恢复';
          objective.status = 'interrupted';
          objective.reason = task.blockReason;
          return null;
        }
        return migrated;
      };
      return {
        ...ship,
        current: migrateDirective(ship.current, 'current'),
        queue: ship.queue.map((d) => migrateDirective(d, 'queue')!),
        suspended: ship.suspended
          .map((d) => migrateDirective(d, 'suspended'))
          .filter((d): d is NonNullable<typeof d> => d !== null),
      };
    });
    const groupDirectives = ships
      .flatMap((ship) => [ship.current, ...ship.queue, ...ship.suspended])
      .filter((d): d is NonNullable<typeof d> => !!d?.groupOrderId);
    for (const d of groupDirectives) {
      const task = agentRuntime.tasks.find((t) => t.taskId === d.taskId)!;
      task.group = {
        orderId: d.groupOrderId!,
        total: d.groupTotal,
        slot: d.groupSlot,
        spacing: d.groupSpacing,
        taskIds: groupDirectives
          .filter((peer) => peer.groupOrderId === d.groupOrderId)
          .sort((a, b) => a.groupSlot - b.groupSlot)
          .map((peer) => peer.taskId!),
      };
    }
    for (const ship of ships)
      for (const kind of ['materials', 'photon', 'quantum', 'specialFinds'] as const) {
        let left = ship.cargo[kind];
        for (const d of [
          ship.current,
          ...ship.suspended,
          ...agentRuntime.tasks
            .filter((t) => t.assignedShipIds.includes(ship.id))
            .map((t) => t.checkpoint),
        ])
          if (d?.taskId && d.action.type === 'HAUL' && d.action.cargoKind === kind) {
            const amount = Math.min(left, Math.max(0, d.carried - d.delivered - (d.lost ?? 0)));
            left -= amount;
            if (amount > 0)
              agentRuntime.cargoLots.push({
                lotId: 'lot:' + agentRuntime.nextLot++,
                shipId: ship.id,
                taskId: d.taskId,
                sourceId: d.action.sourceId,
                cargoKind: kind,
                amount,
                acquiredTick: old.tick,
              });
          }
        if (left > 0)
          agentRuntime.cargoLots.push({
            lotId: 'lot:' + agentRuntime.nextLot++,
            shipId: ship.id,
            taskId: null,
            sourceId: null,
            cargoKind: kind,
            amount: left,
            acquiredTick: old.tick,
          });
      }
    for (const message of old.chatMessages)
      for (const [agentId, response] of Object.entries(message.responses ?? {})) {
        const reply = old.chatMessages.find(
          (m) => m.sender === agentId && m.replyTo === message.id,
        );
        agentRuntime.replies.push({
          key: `reply:${message.id}:${agentId}`,
          sourceMessageId: message.id,
          recipientAgentId: agentId,
          phase: reply || response === 'replied' ? 'committed' : 'failed',
          primaryMessageId: reply?.id ?? null,
          error: null,
          revision: 0,
        });
      }
    const agents = base.agents.map(({ assignedShipId: _old, ...a }) => ({
      ...a,
      modelConfig: {
        ...a.modelConfig,
        thinking: null,
        reasoningEffort:
          a.modelConfig.reasoningEffort === 'none'
            ? ('provider-default' as const)
            : a.modelConfig.reasoningEffort,
      },
      decision: {
        ...a.decision,
        revision: a.decision.revision + 1,
        pendingReasons: [],
        events: [],
        lastAdmiralMessageId: Math.max(
          a.decision.lastAdmiralMessageId,
          0,
          ...old.chatMessages
            .filter(
              (m) =>
                m.sender === old.commander.id &&
                (m.channelId === 'private:' + a.id || m.mentions.includes(a.id)),
            )
            .map((m) => m.id),
        ),
      },
    }));
    const migrated = { ...base, version: 16 as const, ships, agents, objectives, agentRuntime };
    for (const wreck of migrated.wrecks) {
      const loss = old.losses.find((l) => 'wreck:' + l.shipId === wreck.id);
      if (loss) Object.assign(wreck, { sourceShipId: loss.shipId, sourceClassId: loss.classId });
    }
    for (const event of migrated.events.filter(
      (v) => v.kind === 'accident' && ['reported', 'responding'].includes(v.stage),
    )) {
      event.stage = 'resolved';
      event.outcome = '规则移除：保留事故历史与已消耗资源，恢复生产';
      const removed = new Set<string>();
      for (const ship of ships) {
        const retire = (d: typeof ship.current) => {
          if (d?.action.type === 'ASSIST_EVENT' && d.action.targetId === event.id) {
            removed.add(d.id);
            if (d.taskId) {
              const task = agentRuntime.tasks.find((t) => t.taskId === d.taskId)!;
              task.status = 'cancelled';
              task.blockReason = event.outcome;
              const objective = objectives.find((o) => o.id === task.objectiveId)!;
              objective.status = 'cancelled';
              objective.reason = event.outcome;
            }
            return null;
          }
          return d;
        };
        ship.current = retire(ship.current);
        ship.queue = ship.queue.map(retire).filter((d): d is NonNullable<typeof d> => d !== null);
        ship.suspended = ship.suspended
          .map(retire)
          .filter((d): d is NonNullable<typeof d> => d !== null);
        if (!ship.current) {
          ship.path = [];
          ship.status = 'idle';
        }
      }
      for (const c of migrated.commitments.filter(
        (c) => c.directiveId && removed.has(c.directiveId),
      )) {
        migrated.resources.credits += c.escrow;
        c.escrow = 0;
        c.status = 'refunded';
      }
      for (const r of migrated.escortRequests.filter(
        (r) => r.action?.type === 'ASSIST_EVENT' && r.action.targetId === event.id,
      )) {
        r.status = 'cancelled';
        r.reason = event.outcome;
      }
    }
    return restoreAssignments(worldSchema.parse(migrated));
  }
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return restoreAssignments(worldSchema.parse(input));
}
