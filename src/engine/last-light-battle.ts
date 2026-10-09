import { createWorld, makeLocation, makeShip, makeEnemy } from './data';
import { materialize } from './world-generation';
import { SimulationEngine } from './engine';
import { parseSave } from './saves';
import { makeAgent, registerAgent } from './agents';
import { COMMAND_CHANNEL, appendChat } from './chat';
import { updateSensors, observe } from './sensors';
import { dist, move } from './navigation';
import { capabilities } from './capabilities';
import type { WorldState } from './types';

export const LAST_LIGHT_BATTLE_NAME = 'LAST LIGHT / BATTLE DEMO';
const READY = 'lastLightBattleReady';
const AMBUSH = 'lastLightAmbush';
const RESPONDED = 'lastLightBattleResponded';
const FINISHED = 'lastLightBattleFinished';
const scripted = (w: WorldState, kind: string) => w.history.some((entry) => entry.kind === kind);

export function isLastLightBattleWorld(w: WorldState): boolean {
  return scripted(w, READY);
}

/** New independent timeline: the earlier haul demo is already finished.
 * No LLM-generated responses are invented; only the rescue chat is visibly
 * labelled as scripted scene dialogue. Physical combat and recon remain real.
 */
export function createLastLightBattleWorld(): WorldState {
  const e = new SimulationEngine(createWorld(236807));
  const w = e.state;
  w.resources.credits = 12500;
  w.upgrades = { shipyard: 1, armory: 1, logistics: 1, sensors: 1, defense: 1 };
  const base = w.locations.find((l) => l.id === 'base')!;
  base.stock.materials = Math.min(3600, base.capacity.materials);
  base.stock.photon = Math.min(340, base.capacity.photon);
  base.stock.quantum = Math.min(140, base.capacity.quantum);
  base.stock.specialFinds = Math.min(15, base.capacity.specialFinds);

  // Store the source in the actual destination sector of Dawn Passage.
  const portal = w.wormholes.find((h) => h.id === 'wormhole:0:0')!;
  portal.stable = true;
  portal.stability = 1;
  portal.surveyed = true;
  portal.discovered = true;
  const mine = makeLocation('demo-aurora-mine', 'AURORA MINE / 极光矿场',
    'mine', { x: portal.exit.x + 110, y: portal.exit.y + 40 });
  mine.stock.materials = Math.min(1300, mine.capacity.materials);
  w.locations.push(mine);

  const freighter = w.ships.find((s) => s.id === 'meridian')!;
  freighter.x = -15;
  freighter.y = 55;
  freighter.status = 'active';
  freighter.cargo.materials = 500;
  freighter.piracyPolicy = 'preserveShip';
  const travel = e.dispatchCommand({
    type: 'issueDirective', shipIds: [freighter.id], mode: 'REPLACE',
    action: { type: 'HAUL', sourceId: mine.id, targetId: base.id,
      cargoKind: 'materials', amount: 500, loadPolicy: 'fixed',
      route: 'risky', repeat: false },
  });
  if (!travel.ok || !freighter.current)
    throw Error('LAST LIGHT freighter setup: ' + travel.reason);
  // This is a scene checkpoint of a PREVIOUS physical haul, not an Agent claim.
  freighter.current.phase = 'delivering';
  freighter.current.carried = 500;
  freighter.current.delivered = 0;
  freighter.current.work = 0;
  freighter.current.journey = null;
  freighter.current.reserved.materials = 0;

  const horizon = w.ships.find((s) => s.id === 'horizon')!;
  horizon.x = -115;
  horizon.y = 95;
  horizon.status = 'active';
  const resolute = makeShip('resolute', 'USS RESOLUTE / 坚毅号',
    'galaxy', 'starfleet', { x: -105, y: -45 });
  w.ships.push(resolute);
  w.assignments.push({ operatorId: 'ops-resolute-demo', shipId: resolute.id, since: w.time });
  for (const ship of [horizon, resolute]) {
    ship.hull = capabilities(ship).hull;
    ship.shield = capabilities(ship).shield;
    ship.photon = Math.min(200, capabilities(ship).photon);
    ship.quantum = Math.min(45, capabilities(ship).quantum);
    ship.standing.roe = 'ENGAGE HOSTILES';
  }

  const veil = makeShip('veil', 'USS VEIL / 深奥号', 'veil',
    'starfleet', { x: -10, y: 170 });
  veil.cloak = 'on';
  veil.status = 'active';
  w.ships.push(veil);
  w.operators.push({ id: 'ops-veil', name: 'VEIL / Admiral reconnaissance',
    kind: 'rules', availability: 'available' });
  w.assignments.push({ operatorId: 'ops-veil', shipId: veil.id, since: w.time });
  materialize(w, { q: 0, r: 12 });
  const veilWreck = w.bodies.find((b) => b.id === 'veil-derelict');
  if (!veilWreck) throw Error('Cannot materialize canonical VEIL wreck');
  veilWreck.specialClaimed = true;
  w.recoveredVeil = true;

  for (const [id, name, career, ship] of [
    ['ops-meridian', 'Mira', 'logistics', 'meridian'],
    ['ops-horizon', 'Talia', 'battle', 'horizon'],
    ['ops-resolute-demo', 'Rhea', 'battle', 'resolute'],
  ] as const) {
    const a = makeAgent(id, name, career, ship);
    // Only this explicitly SCRIPTED rescue sequence is non-LLM. Enable
    // authentic Agent decisions once all real ambushers have been cleared.
    a.enabled = false;
    a.status = 'offline';
    a.decision.pendingReasons = [];
    a.decision.events = [];
    a.decision.nextAt = 1000000;
    if (id === 'ops-resolute-demo') registerAgent(w, a);
    else {
      const existing = w.agents.find((agent) => agent.id === id)!;
      existing.enabled = a.enabled;
      existing.status = a.status;
      existing.decision.pendingReasons = [];
      existing.decision.events = [];
      existing.decision.nextAt = a.decision.nextAt;
    }
  }

  w.enemies = w.enemies.filter((s) => s.factionId === 'orion');
  // The existing generation generally has 10 Orion ships. Ensure a fixed
  // 11-ship scenario without allowing the pirate economy to spawn more.
  const prior = w.enemies.find((s) => s.id === 'orion-raider-4') ??
    w.enemies.find((s) => s.classId === 'orionRaider')!;
  delete w.orion.patrols[prior.id];
  prior.id = 'orion-escape';
  prior.name = 'orion-escape';
  prior.homeId = 'orion-base';
  prior.intent = 'retreat';
  const hq = w.locations.find((l) => l.id === 'orion-base')!;
  prior.x = 320;
  prior.y = 130;
  prior.destination = { x: hq.x, y: hq.y };
  prior.nextDecision = 1000000;
  while (w.enemies.filter((s) => s.factionId === 'orion').length < 11) {
    const n = w.enemies.length;
    w.enemies.push(makeEnemy('orion-demo-raider-' + n, 'orionRaider', 'orion',
      { x: hq.x + n, y: hq.y + n }, hq.id, 'raider'));
  }
  w.orion.operations = [];
  w.orion.jobs = [];
  w.orion.logistics = [];
  w.orion.provisioning = [];
  w.orion.intelligence = {};
  w.factions.orion.reports = [];
  w.orion.nextPlan = 0;
  w.intel = [];
  w.contactAlerts = [];
  e.record(READY, 'BATTLE DEMO：运输已完成装载，Mira 正在真实返航。下一次继续模拟将触发 Orion 集体伏击。', freighter.id, false);
  w.paused = true;
  w.speed = 1;
  w.pauseReasons = [];
  return parseSave(w);
}

export function advanceLastLightBattle(e: SimulationEngine, dt: number): void {
  const w = e.state;
  if (!isLastLightBattleWorld(w) || !scripted(w, AMBUSH)) return;
  const ambush = w.history.find((h) => h.kind === AMBUSH)!;
  const freighter = w.ships.find((s) => s.id === 'meridian')!;
  const escape = w.enemies.find((s) => s.id === 'orion-escape' && s.hull > 0);
  const hq = w.locations.find((l) => l.id === 'orion-base' && l.hull > 0);
  if (escape && hq) {
    escape.intent = 'retreat';
    escape.homeId = hq.id;
    escape.destination = { x: hq.x, y: hq.y };
    // Standard navigation movement: VEIL can physically follow and observe.
    move(escape, hq, dt);
  }
  if (!scripted(w, RESPONDED) && w.time - ambush.time >= 0.4) {
    // Detect the deployed ships with actual VEIL/freighter sensor ranges.
    updateSensors(e);
    const foes = w.enemies.filter((s) =>
      s.factionId === 'orion' && s.id !== 'orion-escape' && s.hull > 0);
    const visible = foes.filter((s) =>
      w.intel.some((i) => i.id === s.id && !i.resolved));
    if (visible.length !== foes.length) return;
    const order = e.dispatchCommand({
      type: 'issueDirective', mode: 'REPLACE',
      shipIds: ['horizon', 'resolute'],
      action: { type: 'ATTACK_SET', targetIds: visible.map((s) => s.id) },
    });
    if (!order.ok) {
      e.log('LAST LIGHT 战斗派遣等待：' + order.reason, 'warning');
      return;
    }
    appendChat(e, 'ops-horizon', COMMAND_CHANNEL,
      '【剧情脚本·非 LLM】@Mira 收到求援。USS HORIZON 正在赶赴交战区域，对 Orion 袭击舰实施拦截。',
      ['ops-meridian'], 'reply', { origin: 'engine', eventId: 'lastLight:accept:Talia' });
    appendChat(e, 'ops-resolute-demo', COMMAND_CHANNEL,
      '【剧情脚本·非 LLM】@Mira 收到。USS RESOLUTE 参战，与 HORIZON 联合压制敌方舰队。',
      ['ops-meridian'], 'reply', { origin: 'engine', eventId: 'lastLight:accept:Rhea' });
    e.record(RESPONDED, '演示群聊回复完成，两艘 Galaxy 已收到真实 ATTACK_SET 作战指令。',
      freighter.id, false);
  }
  if (scripted(w, RESPONDED) && !scripted(w, FINISHED)) {
    const remaining = w.enemies.filter((s) =>
      s.factionId === 'orion' && s.id !== 'orion-escape' && s.hull > 0);
    if (remaining.length && w.tick % 10 === 0) {
      const contacts = remaining.filter((enemy) => w.intel.some((intel) =>
        intel.id === enemy.id && !intel.resolved &&
        w.time - intel.lastSeen <= 30));
      if (contacts.length) {
        for (const shipId of ['horizon', 'resolute']) {
          const ship = w.ships.find((s) => s.id === shipId);
          if (!ship || ship.hull <= 0 || ship.current) continue;
          // An ATTACK_SET can legitimately finish with unconfirmed targets.
          // Keep real combat going while a real sensor contact survives.
          e.dispatchCommand({
            type: 'issueDirective',
            shipIds: [shipId], mode: 'REPLACE',
            action: { type: 'ATTACK_SET', targetIds: contacts.map((s) => s.id) },
          });
        }
      }
    }
    if (!remaining.length) {
      for (const shipId of ['horizon', 'resolute']) {
        const ship = w.ships.find((s) => s.id === shipId);
        if (ship?.current?.action.type === 'ATTACK_SET' && ship.current.source === 'admiral')
          e.complete(ship, '演示拦截结束；舰船已移交真实 Agent 指挥');
      }
      for (const agent of w.agents.filter((a) =>
        a.id === 'ops-horizon' || a.id === 'ops-resolute-demo')) {
        agent.enabled = true;
        agent.status = 'online';
        agent.decision.pendingReasons = [];
        agent.decision.events = [];
        agent.decision.nextAt = w.time + 100000;
      }
      e.record(FINISHED, 'Orion 袭击舰已被消灭。真实 Battle Agent 已启用；Admiral 可在确认总部后向 Talia、Rhea 下达新命令。',
        freighter.id);
    }
  }
}
