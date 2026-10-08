import { worldSchema } from './save-schema';
import { worldSchema as v12Schema } from './legacy-v12/save-schema';
import { worldSchema as v11Schema } from './legacy-v11/save-schema';
import { personalState, decisionWorldKey } from './personality';
import { REPORT_CHANNEL, SYSTEM_ACTOR } from './chat';
import { z } from 'zod';
import type { WorldState } from './types';
export const CURRENT_SAVE_VERSION = 13;
export class UnsupportedSaveVersionError extends Error {}
/** Upgrade structure only: historical chat never becomes a newly authorized command. */
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 11 && input && typeof input === 'object') {
    const old = structuredClone(v11Schema.parse(input)) as Record<string, unknown>;
    old.version = 12;
    old.admiralTasks = [];
    if (Array.isArray(old.agents))
      for (const agent of old.agents) {
        if (
          agent &&
          typeof agent === 'object' &&
          'decision' in agent &&
          agent.decision &&
          typeof agent.decision === 'object'
        )
          Object.assign(agent.decision, {
            lastAdmiralMessageId: typeof old.nextChat === 'number' ? old.nextChat - 1 : 0,
          });
      }
    for (const key of ['ships', 'enemies', 'civilians'])
      if (Array.isArray(old[key]))
        for (const ship of old[key]) {
          if (!ship || typeof ship !== 'object') continue;
          const record = ship as Record<string, unknown>;
          for (const directive of [
            record.current,
            ...(Array.isArray(record.queue) ? record.queue : []),
            ...(Array.isArray(record.suspended) ? record.suspended : []),
          ])
            if (directive && typeof directive === 'object')
              Object.assign(directive, {
                executorAgentId: null,
                sourceMessageId: null,
                taskId: null,
                allowWormholes: true,
              });
        }
    return migrateV12(v12Schema.parse(old));
  }
  if (version === 12) return migrateV12(v12Schema.parse(input));
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
export function migrateV12(old: z.infer<typeof v12Schema>): WorldState {
  const lastChat = old.nextChat - 1;
  const directive = <T extends { source: string }>(d: T) => ({
    ...d,
    contractId: null,
    cycle: 0,
    controlMode: d.source === 'admiral' ? ('direct' as const) : ('autonomous' as const),
  });
  const ships = <
    T extends {
      current: { source: string } | null;
      queue: { source: string }[];
      suspended: { source: string }[];
    },
  >(
    values: T[],
  ) =>
    values.map((s) => ({
      ...s,
      current: s.current ? directive(s.current) : null,
      queue: s.queue.map(directive),
      suspended: s.suspended.map(directive),
    }));
  const world = worldSchema.parse({
    ...old,
    version: 13,
    agents: old.agents.map((a) => ({
      ...a,
      ...personalState(a.id, a.career, old.initialSeed),
      decision: {
        ...a.decision,
        lastAdmiralMessageId: lastChat,
        pendingReasons: [],
        events: [],
        contextKey: '',
        dangerKey: '',
      },
    })),
    chatChannels: [
      ...old.chatChannels,
      {
        id: REPORT_CHANNEL,
        name: 'SYSTEM REPORTS / 系统报告',
        kind: 'reports',
        members: [old.commander.id, SYSTEM_ACTOR, ...old.agents.map((a) => a.id)],
        readThrough: lastChat,
      },
    ],
    chatMessages: old.chatMessages.map((m) => ({
      ...m,
      origin: 'legacy',
      eventId: null,
      requestId: null,
      controlMode: 'voluntary',
    })),
    admiralTasks: old.admiralTasks.map((t) => ({
      ...t,
      controlMode: 'direct',
      consent: 'accepted',
      conditions: [],
      conditionVersion: 1,
      rounds: 0,
      turnAgentId: t.agentId,
      creditsApproved: false,
    })),
    escortRequests: old.escortRequests.map((r) => {
      const delegated = old.admiralTasks.find(
        (t) =>
          t.agentId === r.requesterId &&
          t.carrierAgentId === r.responderId &&
          t.kind === 'construction',
      );
      return {
        ...r,
        status: delegated && ['pending', 'accepted'].includes(r.status) ? 'cancelled' : r.status,
        explicitDeadline: false,
        executionStarted:
          r.status === 'accepted' &&
          old.ships.some(
            (s) => s.current?.action.type === 'ESCORT' && s.current.actorId === r.responderId,
          ),
        kind: delegated ? 'logistics' : 'escort',
        action: delegated ? null : { type: 'ESCORT', targetId: r.targetShipId },
        followUp: null,
        parentTaskId: delegated?.id ?? null,
        conditions: [],
        conditionVersion: 1,
        rounds: 0,
        turnAgentId: r.responderId,
        creditsApproved: false,
        reason: delegated ? 'v12 自动委派作为既有 Admiral 任务保留，不追认为自愿承诺' : null,
      };
    }),
    ships: ships(old.ships),
    enemies: ships(old.enemies),
    civilians: ships(old.civilians),
    commitments: [],
    settledOutcomes: [],
  });
  for (const a of world.agents) {
    a.decision.contextKey = decisionWorldKey(a, world);
    for (const r of world.escortRequests.filter(
      (r) => r.status === 'pending' && r.responderId === a.id,
    )) {
      const id = 'request:' + r.id + ':1';
      a.decision.pendingReasons.push(id);
      a.decision.events.push({ id, kind: 'request', time: world.time });
    }
    a.decision.pendingReasons = a.decision.pendingReasons.slice(-8);
    a.decision.events = a.decision.events.slice(-8);
    for (const s of world.ships) {
      const d = s.current;
      if (d?.action.type === 'ESCORT' && d.actorId === a.id) {
        const targetId = d.action.targetId;
        d.contractId =
          world.escortRequests.find(
            (r) => r.responderId === a.id && r.targetShipId === targetId && r.status === 'accepted',
          )?.id ?? null;
      }
    }
  }
  return worldSchema.parse(world);
}
