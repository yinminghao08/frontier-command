import { describe, it, expect } from 'vitest';
import { quietEngine, issue, until, run, v15Fixture } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { capabilities } from '../src/engine/capabilities';

describe('FAR single execution owner and legacy custody', () => {
  it('Standing Orders submit through authorization and cannot bypass an existing owner', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'verity')!;
    for (const agent of e.state.agents) agent.enabled = false;
    ship.x = e.base.x;
    ship.y = e.base.y;
    ship.hull -= 20;
    const command = {
      type: 'issueDirective' as const,
      shipIds: [ship.id],
      mode: 'REPLACE' as const,
      action: { type: 'REPAIR' as const, targetId: 'base' },
    };
    expect(e.dispatchCommand(command, 'standing:' + ship.id).ok).toBe(false);
    expect(e.runtime.startStanding(ship, command.action).ok).toBe(true);
    const d = ship.current!,
      task = e.state.agentRuntime.tasks.find((t) => t.taskId === d.taskId)!;
    expect(d.source).toBe('standing');
    expect(d.controlMode).toBe('autonomous');
    expect(task.ownerAgentId).toBeNull();
    expect(d.objectiveId).toBe(task.objectiveId);
    expect(d.originInteractionId).toBeTruthy();
    expect(e.runtime.startStanding(ship, { type: 'RETURN' }).ok).toBe(false);
    until(e, () => task.status === 'completed');
    expect(ship.hull).toBe(capabilities(ship).hull);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('emergency interruption preserves the root and checkpoint rather than orphaning an activity', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'verity')!;
    for (const agent of e.state.agents) agent.enabled = false;
    expect(
      e.runtime.startStanding(ship, { type: 'PATROL', targetId: 'base', duration: 30 }).ok,
    ).toBe(true);
    const d = ship.current!,
      task = e.state.agentRuntime.tasks.find((t) => t.taskId === d.taskId)!;
    e.runtime.interruptForSafety(ship);
    ship.current = null;
    ship.path = [];
    e.runtime.drain();
    expect(task.status).toBe('interrupted');
    expect(task.checkpoint?.id).toBe(d.id);
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    run(restored, 2);
    expect(restored.runtime.taskForObjective(task.objectiveId)?.status).toBe('interrupted');
    expect(restored.state.ships.find((s) => s.id === ship.id)!.current).toBeNull();
  });
  it('imports raw v15 hauling and queued orders without replaying cargo, payment or experience', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'meridian')!,
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    for (const agent of e.state.agents) agent.enabled = false;
    e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
    mine.stock.materials = 100;
    ship.x = mine.x;
    ship.y = mine.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 50,
        loadPolicy: 'fixed',
        route: 'safe',
        repeat: false,
      },
      ship.id,
    );
    until(e, () => ship.current?.carried === 50);
    issue(e, { type: 'RETURN' }, ship.id, 'QUEUE');
    const directive = ship.current!,
      queued = ship.queue[0],
      legacy = v15Fixture(e.state);
    expect(legacy.ships.find((s) => s.id === ship.id)!.current?.taskId).toBeNull();
    const restored = new SimulationEngine(parseSave(legacy)),
      loaded = restored.state.ships.find((s) => s.id === ship.id)!;
    expect(loaded.current?.id).toBe(directive.id);
    expect(loaded.current?.paidCredits).toBe(directive.paidCredits);
    expect(loaded.cargo.materials).toBe(50);
    expect(restored.state.resources.credits).toBe(e.state.resources.credits);
    expect(restored.state.agents.map((a) => a.experience)).toEqual(
      e.state.agents.map((a) => a.experience),
    );
    expect(loaded.queue[0].id).toBe(queued.id);
    expect(loaded.queue[0].taskId).not.toBe(loaded.current?.taskId);
    const task = restored.state.agentRuntime.tasks.find(
        (t) => t.taskId === loaded.current!.taskId,
      )!,
      before = restored.base.stock.materials;
    until(restored, () => task.status === 'completed');
    expect(restored.base.stock.materials).toBe(before + 50);
    expect(task.progress.loaded.materials).toBe(50);
    expect(task.progress.delivered.materials).toBe(50);
    until(restored, () => !loaded.current);
    expect(() => parseSave(restored.state)).not.toThrow();
  });
  it('imports a suspended autonomous manifest as an explicitly resumable checkpoint', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'meridian')!,
      agent = e.state.agents.find((a) => a.assignedShipId === ship.id)!;
    const action = {
      type: 'HAUL' as const,
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'materials' as const,
      amount: 50,
      loadPolicy: 'fixed' as const,
      route: 'safe' as const,
      repeat: false,
    };
    const mine = e.state.locations.find((l) => l.id === 'mine')!;
    ship.x = mine.x;
    ship.y = mine.y;
    expect(e.submitAction(agent.id, action).ok).toBe(true);
    until(e, () => ship.current?.carried === 50);
    const directive = structuredClone(ship.current!);
    ship.current = null;
    ship.suspended = [directive];
    const restored = new SimulationEngine(parseSave(v15Fixture(e.state))),
      vessel = restored.state.ships.find((s) => s.id === ship.id)!;
    const task = restored.state.agentRuntime.tasks.find((t) => t.checkpoint?.id === directive.id)!;
    expect(task.status).toBe('interrupted');
    expect(vessel.suspended).toHaveLength(0);
    expect(vessel.cargo.materials).toBe(50);
    expect(
      restored.state.agentRuntime.cargoLots
        .filter((l) => l.taskId === task.taskId)
        .reduce((n, l) => n + l.amount, 0),
    ).toBe(50);
    expect(restored.runtime.resume(task.objectiveId, 0).ok).toBe(true);
    until(restored, () => task.status === 'completed');
    expect(task.progress.delivered.materials).toBe(50);
  });
  it('counts each actual repeating shipment once across reload, without completing its standing objective', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'meridian')!,
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    for (const agent of e.state.agents) agent.enabled = false;
    e.state.upgrades.logistics = 1;
    e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
    mine.stock.materials = 40;
    ship.x = mine.x;
    ship.y = mine.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 20,
        loadPolicy: 'fixed',
        route: 'safe',
        repeat: true,
      },
      ship.id,
    );
    const task = e.state.agentRuntime.tasks.find((t) => t.taskId === ship.current?.taskId)!;
    until(e, () => task.progress.cycles === 1);
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state)))),
      root = restored.runtime.taskForObjective(task.objectiveId)!;
    until(restored, () => root.progress.cycles === 2);
    restored.runtime.drain();
    restored.runtime.drain();
    expect(root.progress.cycles).toBe(2);
    expect(root.progress.loaded.materials).toBe(40);
    expect(root.progress.delivered.materials).toBe(40);
    expect(root.status).not.toBe('completed');
    expect(
      root.completionEvidence.filter((v) => v.description.startsWith('真实运输循环')),
    ).toHaveLength(2);
    expect(() => parseSave(restored.state)).not.toThrow();
  });
});
