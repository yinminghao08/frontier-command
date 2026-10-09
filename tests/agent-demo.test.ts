import { describe, expect, it } from 'vitest';
import { createAgentDemoWorld } from '../src/engine/demo';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { until, run } from './helpers';
import { AgentTestProvider } from './e2e/agent-provider';
import { AgentDecisionService } from '../electron/agents/service';
import { ChatCompletionsClient } from '../electron/agents/client';
import { RequestTracker } from '../electron/agents/runtime';
import { capabilities } from '../src/engine/capabilities';
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 1));
}
describe('fixed-seed v13 autonomous collaboration demo', () => {
  it('starts paused with physical opportunity, damaged escort and paid training, without scripted decisions or consent', () => {
    const w = createAgentDemoWorld();
    expect(w.paused).toBe(true);
    expect(w.speed).toBe(16);
    expect(w.escortRequests).toEqual([]);
    expect(w.commitments).toEqual([]);
    expect(
      w.ships
        .filter((s) => ['meridian', 'horizon'].includes(s.id))
        .every((s) => s.current === null),
    ).toBe(true);
    const ship = w.ships.find((s) => s.id === 'horizon')!;
    expect(ship.hull).toBe(capabilities(ship).hull * 0.65);
    expect(w.wormholes.some((h) => h.discovered && h.surveyed && h.transits > 0)).toBe(true);
    expect(w.personnel.find((p) => p.status === 'training')!.training).toBeGreaterThan(85);
    expect(w.personnel.some((p) => p.status === 'candidate')).toBe(true);
    expect(w.history.some((h) => h.text.includes('录取60 + 训练90 Credits'))).toBe(true);
    expect(
      w.agents.every((a) => a.experience === 0 && a.memory.every((m) => m.kind !== 'decision')),
    ).toBe(true);
    expect(parseSave(w)).toEqual(w);
    expect(createAgentDemoWorld()).toEqual(w);
  });
  it('local HTTP model chooses risk → request → repair/reward negotiation → real engine execution → relationships → next choice', async () => {
    const provider = new AgentTestProvider();
    provider.mode = 'negotiate';
    const baseUrl = await provider.start();
    const e = new SimulationEngine(createAgentDemoWorld()),
      budget = new RequestTracker();
    const service = new AgentDecisionService(
      {
        snapshot: () => e.snapshot(),
        cognitionPort: (id) => e.cognitionPort(id),
        command: (c, id) => e.dispatchCommand(c, id),
        validate: (c, id) => e.validate(c, id),
      },
      () => ({
        baseUrl,
        defaultModel: 'fixture-v13',
        reasoningEffort: 'provider-default',
        apiKey: 'isolated-demo-key',
      }),
      new ChatCompletionsClient(fetch, budget),
    );
    try {
      for (
        let i = 0;
        i < 30 && !e.state.escortRequests.some((r) => r.status === 'awaitingApproval');
        i++
      ) {
        service.pump();
        await flush();
      }
      const request = e.state.escortRequests[0];
      expect(request.status).toBe('awaitingApproval');
      expect(request.rounds).toBe(1);
      expect(request.conditions.map((c) => c.type)).toEqual(['repair', 'reward']);
      expect(e.state.ships.find((s) => s.id === 'meridian')!.current).toBeNull();
      const credits = e.state.resources.credits,
        materials = e.base.stock.materials,
        source = e.state.locations.find((l) => l.id === 'demo-aurora-mine')!,
        start = source.stock.materials;
      expect(
        e.dispatchCommand({
          type: 'resolveProposal',
          contractId: request.id,
          version: request.conditionVersion,
          response: 'approve',
        }).ok,
      ).toBe(true);
      expect(e.state.resources.credits).toBe(credits - 25);
      const ship = e.state.ships.find((s) => s.id === 'horizon')!,
        freighter = e.state.ships.find((s) => s.id === 'meridian')!;
      until(e, () => ship.current?.action.type === 'REPAIR');
      const repairing = new SimulationEngine(parseSave(e.state));
      until(
        e,
        () => freighter.current?.phase === 'delivering' && freighter.current.journey !== null,
      );
      expect(source.stock.materials).toBeLessThan(start - 40);
      expect(ship.hull / capabilities(ship).hull).toBeGreaterThanOrEqual(0.9);
      expect(freighter.current!.journey!.legs.some((l) => l.type === 'wormhole')).toBe(true);
      const replay = new SimulationEngine(parseSave(e.state));
      until(e, () => request.status === 'completed');
      run(replay, (e.state.tick - replay.state.tick) / 10);
      run(repairing, (e.state.tick - repairing.state.tick) / 10);
      expect(replay.state).toEqual(e.state);
      expect(repairing.state).toEqual(e.state);
      expect(e.base.stock.materials).toBe(materials + 40);
      expect(e.state.agents.find((a) => a.id === 'ops-horizon')!.rewardCredits).toBe(25);
      expect(
        e.state.agents.find((a) => a.id === 'ops-meridian')!.relationships['ops-horizon'].trust,
      ).toBe(56);
      expect(
        e.state.agentRuntime.tasks.some(
          (task) =>
            task.status === 'completed' &&
            e.state.objectives.find((o) => o.id === task.objectiveId)?.goal.kind === 'operation' &&
            task.progress.delivered.materials === 40,
        ),
      ).toBe(true);
      expect(e.state.agents.some((a) => a.originPersonnelId)).toBe(true);
      e.state.paused = true;
      e.dispatchCommand({
        type: 'sendChat',
        channelId: 'private:ops-meridian',
        content: '请评估第二轮货运的合作对象。',
        mentions: [],
      });
      for (let i = 0; i < 20 && e.state.escortRequests.length < 2; i++) {
        service.pump();
        await flush();
      }
      expect(e.state.escortRequests[1].responderId).toBe('ops-horizon');
      const bodies = provider.requests.filter(
        (r) => !r.messages[0].content.includes('Reply only JSON:'),
      );
      expect(bodies.some((r) => r.messages[1].content.includes('"trust":56'))).toBe(true);
      expect(budget.stats().requests).toBe(provider.requests.length);
      expect(budget.stats().concurrency).toBe(0);
      expect(() => parseSave(e.state)).not.toThrow();
    } finally {
      service.dispose();
      budget.dispose();
      await provider.close();
    }
  });
});
