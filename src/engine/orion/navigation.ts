import type { SimulationEngine } from '../engine';
import type { Enemy, Point, IntelRecord } from '../types';
import { dist, move, planRoute } from '../navigation';
import { localReports } from './intelligence';
/** Navigation uses the faction's received chart, never the player's discovery flags or plans. */
export function goOrion(e: SimulationEngine, s: Enemy, destination: Point, dt: number) {
  if (
    !s.path.length ||
    dist(s.path.at(-1)!, destination) > 1 ||
    (s.cooldowns.orionRoute ?? 0) <= 0
  ) {
    const intel: IntelRecord[] = localReports(e, s)
      .filter((r) => r.defense > 500 && e.state.time - r.seenAt <= 30)
      .map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
        level: 'IDENTIFIED',
        strength: 6,
        lastSeen: r.seenAt,
        live: true,
        hostile: true,
        velocity: r.velocity,
        resolved: false,
      }));
    s.path = planRoute(
      {
        locations: [],
        bodies: [],
        sectors: [],
        upgrades: { shipyard: 0, armory: 0, sensors: 0, logistics: 0, defense: 0 },
        intel,
        time: e.state.time,
      },
      s,
      { x: destination.x, y: destination.y },
      'safe',
      260,
    );
    s.cooldowns.orionRoute = 5;
  }
  s.destination = { x: destination.x, y: destination.y };
  if (s.path[0] && move(s, s.path[0], dt)) s.path.shift();
}
