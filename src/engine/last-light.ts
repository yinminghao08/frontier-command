/** OPERATION LAST LIGHT — a deterministic WORLD encounter, not an Agent decision.
 * The LLM retains full authority over Mira/Talia consent and their dialogue.
 * No save schema extensions: durable one-shot flags live in world.history.
 */
import type { SimulationEngine } from './engine';
import { capabilities } from './capabilities';
import { dist } from './navigation';
import { appendChat, COMMAND_CHANNEL } from './chat';
import { updateSensors, observe } from './sensors';
import type { WorldState } from './types';
import { isLastLightBattleWorld } from './last-light-battle';

const ESCAPE_SHIP = 'orion-escape';
const hasEvent = (w: WorldState, kind: string) => w.history.some((h) => h.kind === kind);
export function isLastLightWorld(w: WorldState): boolean {
  return w.agents.some((a) => a.id === 'ops-resolute-demo') &&
    w.locations.some((l) => l.id === 'demo-aurora-mine') &&
    w.enemies.some((s) => s.id === ESCAPE_SHIP);
}
export const isLastLightWaiting = (w: WorldState) =>
  isLastLightWorld(w) && !hasEvent(w, 'lastLightAmbush');
export const isLastLightDeployed = (w: WorldState) =>
  isLastLightWorld(w) && hasEvent(w, 'lastLightAmbush');

function hasAuroraDelivery(w: WorldState): boolean {
  const ship = w.ships.find((s) => s.id === 'meridian');
  if (!ship) return false;
  const directive = ship.current?.action;
  const activeDirective = directive?.type === 'HAUL' &&
    directive.sourceId === 'demo-aurora-mine' &&
    directive.targetId === 'base';
  const existingObjective = w.objectives.some((o) =>
    o.ownerAgentId === 'ops-meridian' &&
    ['active', 'blocked', 'interrupted'].includes(o.status) &&
    (o.goal.kind === 'loadReturn' &&
      o.goal.sourceId === 'demo-aurora-mine' &&
      o.goal.destinationId === 'base' ||
      o.goal.kind === 'operation' &&
      o.goal.action.type === 'HAUL' &&
      o.goal.action.sourceId === 'demo-aurora-mine' &&
      o.goal.action.targetId === 'base'));
  return activeDirective || existingObjective;
}

/** Happens after advanceShip, which emits real shipTransited events. */
export function advanceLastLight(e: SimulationEngine): void {
  const w = e.state;
  if (!isLastLightWaiting(w)) return;
  const ship = w.ships.find((s) => s.id === 'meridian');
  const base = w.locations.find((l) => l.id === 'base');
  if (!ship || !base || ship.hull <= 0) return;

  // The older v3 mistakenly required >=100 Materials even if the player's
  // valid order was 20. The actual cargo and Aurora source now matter, not
  // an arbitrary quantity, an Agent reply or a special model disposition.
  const actualHaul = ship.current?.action;
  if (actualHaul?.type === 'HAUL' &&
      actualHaul.sourceId !== 'demo-aurora-mine' &&
      !hasEvent(w, 'lastLightWrongSource')) {
    e.record('lastLightWrongSource',
      'LAST LIGHT：运输起点不是 AURORA MINE。请选择 AURORA MINE → Dawn Starbase；仅更改聊天文字不会改变真实 HAUL 指令。',
      ship.id);
  }
  if (ship.cargo.materials <= 0 || !hasAuroraDelivery(w)) return;
  const homeTransit = e.pendingEvents.some((event) =>
    event.type === 'shipTransited' &&
    event.shipId === ship.id &&
    Math.hypot(event.destination.x - base.x, event.destination.y - base.y) < 900);
  // Also support a genuine physical return using a normal route rather than
  // permanently waiting for a particular wormhole event to exist.
  const approachingDawn = ship.current?.action.type === 'HAUL' &&
    ship.current.phase === 'delivering' &&
    Math.hypot(ship.x - base.x, ship.y - base.y) < 760;
  if (!homeTransit && !approachingDawn) return;

  const attackers = w.enemies.filter((s) => s.factionId === 'orion' && s.hull > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!attackers.length) return;
  attackers.forEach((enemy, i) => {
    if (isLastLightBattleWorld(w) && enemy.id === ESCAPE_SHIP) return;
    const angle = 0.45 + i * (2 * Math.PI) / attackers.length;
    const radius = enemy.id === ESCAPE_SHIP ? 170 : 100 + (i % 3) * 12;
    enemy.x = ship.x + Math.cos(angle) * radius;
    enemy.y = ship.y + Math.sin(angle) * radius;
    enemy.path = [];
    enemy.current = null;
    enemy.queue = [];
    enemy.suspended = [];
    enemy.status = 'active';
    enemy.intent = 'observe';
    enemy.targetId = null;
    enemy.destination = null;
    enemy.nextDecision = w.time;
    enemy.lastAttackerId = null;
    enemy.attackedAt = -1000;
    enemy.localReports = [];
    enemy.counterTracking.position = { x: enemy.x, y: enemy.y };
    enemy.counterTracking.evading = false;
    enemy.counterTracking.waypoints = [];
    w.orion.patrols[enemy.id] = { anchor: { x: enemy.x, y: enemy.y }, leg: 0 };
  });
  if (isLastLightBattleWorld(w)) {
    for (const enemy of attackers.filter((s) => s.id !== ESCAPE_SHIP)) {
      enemy.hull = Math.min(enemy.hull, Math.ceil(capabilities(enemy).hull * 0.72));
      enemy.shield = Math.min(enemy.shield, Math.ceil(capabilities(enemy).shield * 0.72));
    }
    appendChat(e, 'ops-meridian', COMMAND_CHANNEL,
      '@Talia @Rhea 紧急求援！MERIDIAN-1 满载返航途中遭 Orion 集群袭击。请求 HORIZON 与 RESOLUTE 立即驰援！',
      ['ops-horizon', 'ops-resolute-demo'], 'request',
      { origin: 'engine', eventId: 'lastLight:request:Mira', purpose: 'information' });
    updateSensors(e);
    for (const enemy of attackers) {
      const sensors = w.ships.filter((s) =>
        s.hull > 0 && dist(s, enemy) <= capabilities(s).sensors);
      if (sensors.length) observe(w, enemy, 10);
    }
  }
  w.orion.nextPlan = w.time;
  const message = 'ORION AMBUSH：' + attackers.length +
    ' 艘 Orion 战舰同时出现在 MERIDIAN-1 返航航线上。';
  e.record('lastLightAmbush', message, ship.id, false);
  e.report(message, ship.id, 'urgent', 'threat');
  e.critical('newContact', ship.id, message);
  e.record('lastLightFirstContact', message, ship.id, false);
}

/** No immunity: this real Raider retreats after two actual Orion losses. */
export function advanceLastLightRetreat(e: SimulationEngine): void {
  const w = e.state;
  if (isLastLightBattleWorld(w) || !isLastLightDeployed(w) || hasEvent(w, 'lastLightEscape')) return;
  if (w.factions.orion.losses.length < 2) return;
  const ship = w.enemies.find((s) => s.id === ESCAPE_SHIP && s.hull > 0);
  const hq = w.locations.find((l) => l.id === 'orion-base' && l.hull > 0);
  if (!ship || !hq) return;
  ship.intent = 'retreat';
  ship.targetId = null;
  ship.destination = { x: hq.x, y: hq.y };
  ship.nextDecision = w.time + 1000;
  e.record('lastLightEscape', ship.name + ' 正撤向 Orion 秘密总部', ship.id, false);
}
