import type { Agent, Ship } from './types';
import type { SimulationEngine } from './engine';
import { AGENT_RULES } from './definitions/agents';
import { capabilities } from './capabilities';
import { clampMood, personalFeedback } from './personality';
import { dist } from './navigation';
import { inventory, available, haulLoad } from './inventory';
import { remember, wakeAgent } from './chat';
import { SHIP_CLASSES, WEAPONS } from './definitions/ships';

export function agentDamageFeedback(e: SimulationEngine, ship: Ship, previousHull: number) {
  const a = e.state.agents.find((a) => a.assignedShipId === ship.id);
  if (!a) return;
  const state = a.stateDynamics;
  if (
    state.engagementTick === null ||
    e.state.time - state.lastDangerAt >= AGENT_RULES.engagementQuietMinutes
  ) {
    state.engagementTick = e.state.tick;
    state.hullBands = [];
  }
  state.lastDangerAt = e.state.time;
  if (
    personalFeedback(
      a,
      `${ship.id}:engagement:${state.engagementTick}:hit`,
      { stress: 8 },
      e.state.time,
      '遭到实际攻击',
    )
  )
    e.record('agentState', a.name + ' 遭到实际攻击：压力 +8', a.id, false);
  const max = capabilities(ship).hull;
  for (const band of [75, 50, 30]) {
    if (
      (previousHull / max) * 100 > band &&
      (ship.hull / max) * 100 <= band &&
      !state.hullBands.includes(band)
    ) {
      state.hullBands.push(band);
      if (
        personalFeedback(
          a,
          `${ship.id}:engagement:${state.engagementTick}:hull:${band}`,
          { stress: 5, confidence: -3 },
          e.state.time,
          `舰体跌至 ${band}% 以下`,
        )
      )
        e.record('agentState', `${a.name} 舰体跌至 ${band}% 以下：压力 +5，信心 −3`, a.id, false);
    }
  }
}

export function advanceAgentState(
  e: SimulationEngine,
  a: Agent,
  ship: Ship | undefined,
  dt: number,
) {
  const state = a.stateDynamics,
    w = e.state;
  const threatened =
    !!ship &&
    w.intel.some(
      (i) => i.live && i.hostile && !i.resolved && dist(ship, i) < capabilities(ship).sensors,
    );
  const d = ship?.current;
  const action = d?.action;
  const attackId =
    action?.type === 'ATTACK_SET'
      ? action.targetIds[d?.targetIndex ?? 0]
      : action && ['ATTACK', 'DISABLE', 'DRIVE_OFF'].includes(action.type) && 'targetId' in action
        ? action.targetId
        : null;
  const target = attackId
    ? (w.intel.find((i) => i.id === attackId && i.live && !i.resolved) ??
      w.locations.find(
        (l) => l.id === attackId && l.discovered && l.owner !== 'starfleet' && l.hull > 0,
      ))
    : null;
  const inRange =
    ship &&
    target &&
    SHIP_CLASSES[ship.classId].weapons.some((id) => dist(ship, target) <= WEAPONS[id].range);
  // A confirmed exchange continues through weapon cooldowns while the real
  // target remains in range; approach and safe waiting are still ordinary work.
  const combat =
    !!ship &&
    (w.time - ship.attackedAt < 2 ||
      (ship.cooldowns.agentFiring ?? 0) > 0 ||
      (inRange && (ship.cooldowns.agentEngaged ?? 0) > 0));
  const site =
    ship && w.locations.find((l) => l.owner === 'starfleet' && l.hull > 0 && dist(ship, l) <= 12);
  let working = !!d;
  if (d?.action.type === 'HAUL' && d.phase === 'starting' && ship) {
    const src = inventory(w, d.action.sourceId);
    if (
      src &&
      dist(ship, src) <= 8 &&
      haulLoad(w, ship, d.action, Math.max(0, d.carried - d.delivered - (d.lost ?? 0))) < 1
    )
      working = false;
  }
  if (d?.action.type === 'REPAIR' && ship) {
    const dest = inventory(w, d.action.targetId);
    if (dest && dist(ship, dest) <= 12 && available(w, dest.id, 'materials') < 1) working = false;
  }
  if (d?.phase === 'waiting') working = false;
  if (d?.action.type === 'HAUL' && d.phase === 'delivering' && ship) {
    const dest = inventory(w, d.action.targetId);
    if (
      dest &&
      dist(ship, dest) <= 8 &&
      dest.stock[d.action.cargoKind] >= dest.capacity[d.action.cargoKind]
    )
      working = false;
  }
  const resting =
    !combat && !threatened && d?.action.type === 'REST' && !!site && ship?.status === 'docked';
  const activity = combat
    ? 'combat'
    : resting
      ? 'rest'
      : working
        ? 'work'
        : site && !threatened
          ? 'docked'
          : 'idle';
  state.activity = activity;
  state.fatigueRate = AGENT_RULES.fatigue[activity];
  state.stressRate = combat
    ? AGENT_RULES.stress.combat
    : threatened
      ? AGENT_RULES.stress.threat
      : AGENT_RULES.stress[activity];
  state.resentmentRate = resting
    ? AGENT_RULES.restResentment
    : working && a.fatigue >= 80
      ? AGENT_RULES.overworkResentment
      : 0;
  a.fatigue = clampMood(a.fatigue + dt * state.fatigueRate);
  a.psychology.stress = clampMood(a.psychology.stress + dt * state.stressRate);
  a.psychology.resentment = clampMood(a.psychology.resentment + dt * state.resentmentRate);
  if (combat || threatened) state.lastDangerAt = w.time;
  else if (
    state.engagementTick !== null &&
    w.time - state.lastDangerAt >= AGENT_RULES.engagementQuietMinutes
  ) {
    state.engagementTick = null;
    state.hullBands = [];
  }
  for (const [key, value, threshold] of [
    ['fatigue50', a.fatigue, 50],
    ['fatigue80', a.fatigue, 80],
    ['stress60', a.psychology.stress, 60],
    ['resentment50', a.psychology.resentment, 50],
  ] as const) {
    if (value < threshold - 5) state.thresholds = state.thresholds.filter((id) => id !== key);
    if (value >= threshold && !state.thresholds.includes(key)) {
      state.thresholds.push(key);
      remember(w, a, 'decision', `状态变化：${key}，需要重新判断工作与休息`, ship?.id ?? null, 8);
      e.record('agentState', `${a.name} / ${key}`, a.id, false);
      if (a.enabled && ship && key !== 'fatigue50') wakeAgent(a, 'danger:' + key, w.time);
    }
  }
}
