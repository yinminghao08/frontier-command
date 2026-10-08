import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import type { Action } from '../src/engine/types';
import { worldSchema as legacySchema } from '../src/engine/legacy-v12/save-schema';
import { worldSchema as v11Schema } from '../src/engine/legacy-v11/save-schema';
import type { WorldState } from '../src/engine/types';
/** Explicitly construct an authentic old fixture; never relabel a v13 save as v12. */
export function v12Fixture(world: WorldState) {
  const {
    commitments: _commitments,
    settledOutcomes: _settlements,
    ...base
  } = structuredClone(world);
  const cleanDirective = (d: NonNullable<WorldState['ships'][number]['current']>) => {
    const { contractId: _contract, cycle: _cycle, controlMode: _mode, ...old } = d;
    return old;
  };
  const cleanShips = <T extends WorldState['ships'][number]>(ships: T[]) =>
    ships.map(({ ammoAlertActive: _ammoAlert, ...s }) => ({
      ...s,
      current: s.current ? cleanDirective(s.current) : null,
      queue: s.queue.map(cleanDirective),
      suspended: s.suspended.map(cleanDirective),
    }));
  return legacySchema.parse({
    ...base,
    version: 12,
    agents: world.agents.map((a) => {
      const {
        profile: _profile,
        psychology: _psychology,
        longTermGoal: _goal,
        taskPreferences: _preferences,
        rewardCredits: _rewards,
        feedbackEvents: _feedback,
        ...old
      } = a;
      const {
        contextKey: _context,
        dangerKey: _danger,
        events: _events,
        ...decision
      } = old.decision;
      return { ...old, decision };
    }),
    chatChannels: world.chatChannels.filter((c) => c.kind !== 'reports'),
    chatMessages: world.chatMessages
      .filter((m) => m.channelId !== 'system-reports')
      .map((m) => {
        const {
          origin: _origin,
          eventId: _event,
          requestId: _request,
          controlMode: _mode,
          ...old
        } = m;
        return old;
      }),
    admiralTasks: world.admiralTasks.map((t) => {
      const {
        controlMode: _mode,
        consent: _consent,
        conditions: _conditions,
        conditionVersion: _version,
        rounds: _rounds,
        turnAgentId: _turn,
        creditsApproved: _approved,
        ...old
      } = t;
      return old;
    }),
    escortRequests: world.escortRequests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      responderId: r.responderId,
      targetShipId: r.targetShipId,
      created: r.created,
      deadline: r.deadline,
      started: r.started,
      status: r.status,
    })),
    ships: cleanShips(world.ships),
    enemies: cleanShips(world.enemies),
    civilians: cleanShips(world.civilians),
  });
}
export function v11Fixture(world: WorldState) {
  const older = v12Fixture(world),
    { admiralTasks: _tasks, ...base } = older;
  const directive = (d: NonNullable<(typeof older.ships)[number]['current']>) => {
    const {
      executorAgentId: _executor,
      sourceMessageId: _message,
      taskId: _task,
      allowWormholes: _permission,
      ...old
    } = d;
    return old;
  };
  const ships = <T extends (typeof older.ships)[number]>(values: T[]) =>
    values.map((s) => ({
      ...s,
      current: s.current ? directive(s.current) : null,
      queue: s.queue.map(directive),
      suspended: s.suspended.map(directive),
    }));
  return v11Schema.parse({
    ...base,
    version: 11,
    agents: older.agents.map((a) => {
      const { lastAdmiralMessageId: _cursor, ...decision } = a.decision;
      return { ...a, decision };
    }),
    chatMessages: older.chatMessages.map((m) => {
      const { purpose: _purpose, replyTo: _reply, ...old } = m;
      return old;
    }),
    ships: ships(older.ships),
    enemies: ships(older.enemies),
    civilians: ships(older.civilians),
  });
}
export function quietEngine(seed = 236807) {
  const e = new SimulationEngine(createWorld(seed));
  e.state.enemies = [];
  return e;
}
export function issue(
  e: SimulationEngine,
  action: Action,
  shipId = 'verity',
  mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT' = 'REPLACE',
) {
  return e.dispatchCommand({ type: 'issueDirective', shipIds: [shipId], mode, action });
}
export function run(e: SimulationEngine, minutes: number) {
  for (let i = 0; i < Math.round(minutes * 10); i++) {
    if (e.state.status === 'commandLost') break;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
}
export function until(e: SimulationEngine, predicate: () => boolean, maxMinutes = 600) {
  for (let i = 0; i < maxMinutes * 10 && !predicate(); i++) {
    if (e.state.status === 'commandLost') break;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
  if (!predicate()) throw Error('Simulation predicate timed out at ' + e.state.time);
}
