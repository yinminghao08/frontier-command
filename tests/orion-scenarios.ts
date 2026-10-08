import { quietEngine } from './helpers';
import { makeEnemy } from '../src/engine/data';
import { observeOrion } from '../src/engine/orion/intelligence';
import { planOrion } from '../src/engine/orion/tactics';
export function piracyScenario(
  policy: 'preserveShip' | 'preserveCargo' | 'manual' = 'preserveShip',
) {
  const e = quietEngine(),
    ship = e.state.ships.find((s) => s.id === 'meridian')!;
  for (const s of e.state.ships) {
    s.x = -5000;
    s.y = -4000;
    s.standing.roe = 'HOLD FIRE';
  }
  ship.x = 20;
  ship.y = 1200;
  ship.cargo.materials = 200;
  ship.piracyPolicy = policy;
  const home = e.state.locations.find((l) => l.id === 'orion-base')!;
  home.x = -180;
  home.y = 1200;
  const a = makeEnemy('raid-a', 'orionRaider', 'orion', { x: -10, y: 1200 }, home.id, 'raider');
  const b = makeEnemy('raid-b', 'orionRaider', 'orion', { x: 0, y: 1215 }, home.id, 'raider');
  const c = makeEnemy(
    'raid-c',
    'orionInterceptor',
    'orion',
    { x: 0, y: 1185 },
    home.id,
    'interceptor',
  );
  c.modules = ['precisionTargeting'];
  e.state.enemies = [a, b, c];
  observeOrion(e);
  planOrion(e);
  return { e, ship, home, a, b, c, op: e.state.orion.operations[0] };
}
