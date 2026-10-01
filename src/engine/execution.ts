import { attack, permittedTarget, regenerate, shouldRetreat } from './combat';
import { SHIP_CLASSES } from './definitions/ships';
import type { SimulationEngine } from './engine';
import { dist, move } from './navigation';
import { decideExecution } from './rules-controller';
import { advanceService } from './services';
import { decideThreat } from './threats';
import type { Enemy, Location, Ship } from './types';

export function fire(this: SimulationEngine, s: Ship, t: Ship | Location): void {
  attack(this.state, s, t, { random: this.random, hit: this.hit, fired: this.fired });
}
export function advanceShip(this: SimulationEngine, s: Ship, dt: number): void {
  const w = this.state;
  if (s.hull <= 0) return;
  regenerate(s, w.time, dt);
  if (advanceService(this, s, dt)) return;
  if (s.status === 'docked') return;
  const o = w.orders.find((o) => o.id === s.orderId);
  if (!o) {
    this.returnHome(s);
  }
  if (o && !o.settled && shouldRetreat(s, o)) this.withdraw(s, o, '达到撤退条件，保全舰船');
  if (s.status === 'returning') {
    if (s.path.length && move(s, s.path[0], dt, 'romulan')) s.path.shift();
    if (dist(s, this.berth(s)) < 3) this.dock(s);
    return;
  }
  if (!o || o.held) return;
  const p = this.routeTarget(o);
  if (w.tick % 30 === 0 && (o.objective.type === 'ship' || o.objective.type === 'contact'))
    this.setRoute(s, o);
  if (w.tick % 50 === 0 && o.route === 'safe' && s.path.length) this.setRoute(s, o);
  const actor = w.assignments.find((a) => a.shipId === s.id);
  const observation = actor ? this.getObservation(actor.operatorId) : null;
  if (observation && (w.tick % 10 === 0 || s.behavior === 'travel'))
    this.submitIntent(actor!.operatorId, decideExecution(observation, o, p));
  if (s.behavior === 'hold') return;
  const contact = w.intel.find((i) => i.id === s.targetId && i.live && !i.resolved);
  const target =
    s.behavior === 'engage' && contact
      ? w.enemies.find((e) => e.id === contact.id && permittedTarget(w, s, o, e))
      : undefined;
  if (target) {
    s.targetId = target.id;
    s.behavior = 'engage';
    if (o.kind === 'defense' && contact && dist(s, contact) > 80) move(s, contact, dt, o.border);
    this.fire(s, target);
    if (o.kind === 'defense') return;
  } else {
    s.targetId = null;
    s.behavior = o.kind === 'defense' ? 'defend' : o.kind === 'explore' ? 'scan' : 'travel';
    if (p && dist(s, p) > 12 && !s.path.length) this.setRoute(s, o);
  }
  if (s.path.length && move(s, s.path[0], dt, o.border)) s.path.shift();
}
export function advanceEnemy(this: SimulationEngine, e: Enemy, dt: number): void {
  const w = this.state;
  if (e.hull <= 0 || e.departed) return;
  regenerate(e, w.time, dt);
  decideThreat(w, e);
  if (e.intent === 'retreat') {
    e.behavior = 'retreat';
    move(e, e.home, dt);
    if (dist(e, e.home) < 5) {
      e.departed = true;
      const i = w.intel.find((i) => i.id === e.id && i.live);
      if (i) {
        i.resolved = true;
        i.resolution = 'withdrawn';
        this.report('确认敌方接触撤离', i.id, 'high');
      }
    }
    return;
  }
  const known = e.knownTargets.find((t) => t.id === e.targetId);
  const target =
    w.ships.find((s) => s.id === e.targetId) || w.locations.find((l) => l.id === e.targetId);
  if (known) {
    const sensed = target && dist(e, target) <= SHIP_CLASSES[e.classId].sensors;
    e.behavior = 'engage';
    const p = sensed ? target : known;
    if (dist(e, p) > 75) move(e, p, dt);
    if (sensed && target.hull > 0) this.fire(e, target);
    if (sensed && target.hull <= 0) {
      e.targetId = null;
      e.knownTargets = e.knownTargets.filter((t) => t.id !== target.id);
      e.nextDecision = 0;
    }
  } else {
    e.behavior = 'scan';
    if (e.destination) move(e, e.destination, dt);
    if (
      e.factionId === 'romulan' &&
      e.cloak === 'off' &&
      e.core > SHIP_CLASSES[e.classId].core * 0.8 &&
      w.time - e.attackedAt > 20
    )
      e.cloak = 'on';
  }
}
