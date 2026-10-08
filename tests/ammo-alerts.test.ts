import { describe, expect, it } from 'vitest';
import { quietEngine, issue, run } from './helpers';
import { advanceStanding } from '../src/engine/fleet';
import { capabilities } from '../src/engine/capabilities';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';

const alerts = (e: SimulationEngine) =>
  e.state.chatMessages.filter((m) => m.content.includes('弹药不足'));
function setup() {
  const e = quietEngine();
  e.state.agents.forEach((a) => {
    a.enabled = false;
  });
  const s = e.state.ships.find((s) => s.id === 'horizon')!;
  s.standing.serviceWhenDocked = false;
  s.photon = 0;
  s.quantum = 0;
  return { e, s };
}
describe('persistent low ammunition alerts', () => {
  it.each([1, 4, 16] as const)(
    '%sx reports one continuing shortage over two days and preserves it on reload',
    (speed) => {
      const { e, s } = setup();
      e.state.speed = speed;
      e.state.paused = false;
      for (let i = 0; i < (2880 * 10) / speed; i++) {
        e.state.paused = false;
        e.advanceFrame();
      }
      expect(alerts(e)).toHaveLength(1);
      const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
      const ship = restored.state.ships.find((ship) => ship.id === s.id)!;
      ship.name = 'Renamed Horizon';
      s.name = ship.name;
      run(e, 120);
      run(restored, 120);
      expect(alerts(restored)).toHaveLength(1);
      // A display rename cannot affect simulation or the persisted notification latch.
      expect(restored.state).toEqual(e.state);
    },
  );
  it('partial reload stays silent; complete recovery rearms exactly one later warning', () => {
    const { e, s } = setup();
    advanceStanding(e, s);
    const c = capabilities(s);
    s.photon = c.photon;
    advanceStanding(e, s);
    expect(alerts(e)).toHaveLength(1);
    expect(s.ammoAlertActive).toBe(true);
    s.quantum = c.quantum;
    advanceStanding(e, s);
    expect(s.ammoAlertActive).toBe(false);
    s.photon = 0;
    advanceStanding(e, s);
    advanceStanding(e, s);
    expect(alerts(e)).toHaveLength(2);
  });
  it('recovery is tracked under Admiral and Agent control without displacing commands', () => {
    const { e, s } = setup();
    advanceStanding(e, s);
    issue(e, { type: 'PATROL', targetId: 'base', duration: 30 }, s.id);
    const directive = s.current;
    const c = capabilities(s);
    s.photon = c.photon;
    s.quantum = c.quantum;
    advanceStanding(e, s);
    expect(s.ammoAlertActive).toBe(false);
    expect(s.current).toBe(directive);
    s.photon = 0;
    advanceStanding(e, s);
    expect(alerts(e)).toHaveLength(1);
    e.dispatchCommand({ type: 'cancelDirective', shipId: s.id });
    const agent = e.state.agents.find((a) => a.assignedShipId === s.id)!;
    agent.enabled = true;
    advanceStanding(e, s);
    expect(alerts(e)).toHaveLength(1);
    s.photon = c.photon;
    advanceStanding(e, s);
    expect(s.ammoAlertActive).toBe(false);
    s.photon = 0;
    agent.enabled = false;
    advanceStanding(e, s);
    expect(alerts(e)).toHaveLength(2);
  });
  it.each([0, 60])(
    'old cooldown %s becomes a saved latch without repeating history',
    (cooldown) => {
      const { e, s } = setup();
      s.cooldowns.ammoReport = cooldown;
      const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
      const ship = restored.state.ships.find((ship) => ship.id === s.id)!;
      advanceStanding(restored, ship);
      expect(alerts(restored)).toHaveLength(0);
      expect(ship.ammoAlertActive).toBe(true);
      expect(ship.cooldowns).not.toHaveProperty('ammoReport');
      expect(
        parseSave(restored.state).ships.find((ship) => ship.id === s.id)!.ammoAlertActive,
      ).toBe(true);
    },
  );
});
