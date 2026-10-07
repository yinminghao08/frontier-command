import { createWorld, makeLocation } from './data';
import { SimulationEngine } from './engine';
import { COMMAND_CHANNEL, privateChannel } from './chat';
import { worldSchema } from './save-schema';
import type { AgentDecision, Command, WorldState } from './types';

export const AGENT_DEMO_NAME = 'AGENT DEMO / v11 演示';
/** Authored save setup. Decisions are validated once; continuing uses normal simulation rules. */
export function createAgentDemoWorld(): WorldState {
  const e = new SimulationEngine(createWorld());
  const w = e.state;
  w.enemies = [];
  w.resources.credits = 2000;
  w.upgrades.logistics = 1;
  const command = (c: Command, actorId = w.commander.id) => {
    const result = e.dispatchCommand(c, actorId);
    if (!result.ok) throw Error('Agent demo setup: ' + result.reason);
  };
  const advance = (minutes: number) => {
    for (let i = 0; i < Math.round(minutes * 10); i++) {
      command({ type: 'pause', paused: false });
      e.step();
    }
  };
  const decide = (agentId: string, decision: AgentDecision) => {
    const agent = w.agents.find((a) => a.id === agentId)!;
    command(
      {
        type: 'agentDecisionState',
        agentId,
        revision: agent.decision.revision,
        state: 'waiting',
        error: null,
      },
      agentId,
    );
    command(
      { type: 'agentDecision', agentId, revision: agent.decision.revision, decision },
      agentId,
    );
  };
  // Confirm the passage through an actual exploration transit, rather than publishing a hidden exit.
  const hole = w.wormholes.find((h) => h.id === 'wormhole:0:0')!;
  hole.stable = true;
  hole.stability = 1;
  const scout = w.ships.find((s) => s.id === 'verity')!;
  scout.x = hole.x;
  scout.y = hole.y;
  command({
    type: 'issueDirective',
    shipIds: [scout.id],
    mode: 'REPLACE',
    action: { type: 'TRANSIT', targetId: hole.id },
  });
  advance(2.2);
  const mine = makeLocation('demo-aurora-mine', 'AURORA MINE', 'mine', {
    x: scout.x + 110,
    y: scout.y + 40,
  });
  mine.stock.materials = 120;
  w.locations.push(mine);
  e.record('demo', 'AURORA 矿场加入物流网络；已确认虫洞为 Dawn 后方提供运输捷径。', mine.id, false);

  // Both tuition and the first 85 minutes of training have genuinely elapsed in this save.
  const colony = w.locations.find((l) => l.id === 'colony')!.colony!;
  colony.nextCandidate = w.time;
  advance(0.1);
  const trainee = w.personnel.find((p) => p.status === 'candidate')!;
  command({ type: 'candidate', personnelId: trainee.id, accept: true, career: 'battle' });
  advance(85);
  colony.nextCandidate = w.time;
  advance(0.1);

  for (const id of ['meridian', 'horizon']) {
    const ship = w.ships.find((s) => s.id === id)!;
    ship.x = mine.x + (id === 'horizon' ? 20 : 0);
    ship.y = mine.y;
  }
  command({
    type: 'configureAgent',
    agentId: 'ops-horizon',
    modelConfig: { model: null, reasoningEffort: 'low' },
    enabled: true,
  });
  command({
    type: 'configureAgent',
    agentId: 'ops-meridian',
    modelConfig: { model: null, reasoningEffort: 'none' },
    enabled: true,
  });
  command({
    type: 'sendChat',
    channelId: COMMAND_CHANNEL,
    mentions: [],
    content:
      'Agent Demo：Mira 将把 40 Materials 运回 Dawn，Talia 提供护航。虫洞出口已确认。继续 16× 模拟可看到真实装货、穿越、卸货和经验结算；学院另有临近毕业的学员和待录取候选人。',
  });
  const shared = { action: null, messages: [], memory: null, waitMinutes: 180, coordination: null };
  decide('ops-meridian', {
    ...shared,
    goal: '将 AURORA 的 Materials 运回 Dawn',
    rationale:
      '已知矿场有 120 Materials。确认的虫洞大幅缩短 ETA，但携带工业货物穿越远疆需要同僚护航。',
    messages: [
      {
        channelId: privateChannel('ops-meridian'),
        content:
          'Admiral，已发现 AURORA 的运输机会，正在请求护航。我会优先使用已确认的通道并保留剩余库存。',
        mentions: [],
      },
    ],
    coordination: { type: 'requestEscort', agentId: 'ops-horizon', targetShipId: 'meridian' },
  });
  decide('ops-horizon', {
    ...shared,
    goal: '保护 Mira 与 40 Materials 安全返回 Dawn',
    rationale: '舰体、弹药和士气充足，接受此次护航。保持克制交战，完成后再评估下一项任务。',
    action: { type: 'ESCORT', targetId: 'meridian' },
    messages: [
      {
        channelId: privateChannel('ops-horizon'),
        content: 'Admiral，我已接受 Mira 的请求。USS HORIZON 将实际跟随货船并共享虫洞航行规划。',
        mentions: [],
      },
    ],
    coordination: { type: 'answerEscort', requestId: w.escortRequests[0].id, accept: true },
  });
  decide('ops-meridian', {
    ...shared,
    goal: '装载 40 Materials，经已确认虫洞送达 Dawn',
    rationale: 'Talia 已实际执行 ESCORT；选择安全路线，由 Journey Planner 比较 Warp 与已知虫洞。',
    action: {
      type: 'HAUL',
      sourceId: mine.id,
      targetId: 'base',
      cargoKind: 'materials',
      amount: 40,
      route: 'safe',
      repeat: false,
    },
    memory: 'Talia 接受护航并执行 ESCORT，可在后续高价值货运中继续合作。',
  });
  advance(0.1);
  command({ type: 'speed', speed: 16 });
  command({ type: 'pause', paused: true });
  return worldSchema.parse(w);
}
