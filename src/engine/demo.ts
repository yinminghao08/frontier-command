import { createWorld, makeLocation } from './data';
import { SimulationEngine } from './engine';
import { COMMAND_CHANNEL, privateChannel } from './chat';
import { worldSchema } from './save-schema';
import type { Command, WorldState } from './types';
import { capabilities } from './capabilities';

export const AGENT_DEMO_NAME = 'AGENT DEMO / v13 自主协作';
/** Fixed-seed physical setup only. No Agent decisions or consent are pre-populated. */
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
  const escort = w.ships.find((s) => s.id === 'horizon')!;
  escort.hull = capabilities(escort).hull * 0.65;
  e.record(
    'demo',
    'HORIZON 先前任务留下舰损；是否接受支援及提出维修条件由 Talia 自主判断。',
    escort.id,
    false,
  );
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
      'v13 自主协作演示：AURORA 库存与虫洞出口已确认，HORIZON 存在舰损。配置模型后观察风险判断、协商、实际维修和货物交付；待处理请求中的奖励须由 Admiral 确认预算。',
  });
  command({
    type: 'sendChat',
    channelId: privateChannel('ops-meridian'),
    mentions: [],
    content:
      '请评估 AURORA 到 Dawn 的公开航线风险与库存机会。若需要同僚协作，请提出结构化请求并自主判断其条件。',
  });
  command({ type: 'speed', speed: 16 });
  command({ type: 'pause', paused: true });
  return worldSchema.parse(w);
}
