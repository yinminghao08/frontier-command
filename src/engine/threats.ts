import { createEvent } from './world-events';
import type { SimulationEngine } from './engine';
import type { Enemy, ThreatReport } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { regenerate } from './combat';
import { dist, move } from './navigation';
import { RULES } from './definitions/rules';
import { advanceEvasion, canDetectShip } from './tracking';
import { observeOrion } from './orion/intelligence';
import { advanceOrion, planOrion } from './orion/tactics';
function gather(e: SimulationEngine, s: Enemy) {
  const w = e.state;
  const visible = [...w.ships, ...w.civilians].filter((t) => canDetectShip(s, t, w.time));
  const reports: ThreatReport[] = [
    ...visible.map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      observerId: s.id,
      seenAt: w.time,
      kind: 'ship' as const,
      value: cargoUsed(t) * 8,
      defense:
        (t.hull + t.shield) * 0.65 +
        visible
          .filter((v) => v.id !== t.id && dist(v, t) < 130)
          .reduce((n, v) => n + (v.hull + v.shield) * 1.4, 0),
    })),
    ...w.locations
      .filter((l) => l.owner === 'starfleet' && l.hull > 0 && dist(l, s) < capabilities(s).sensors)
      .map((l) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        observerId: s.id,
        seenAt: w.time,
        kind: 'facility' as const,
        value:
          l.stock.materials * 5 +
          (l.colony ? l.colony.population * (0.5 + l.colony.industry / 100) * 0.1 : 0),
        defense:
          l.hull +
          l.shield +
          visible.filter((v) => dist(v, l) < 130).reduce((n, v) => n + v.hull + v.shield, 0),
      })),
  ];
  s.localReports = s.localReports.filter(
    (r) => w.time - r.seenAt < RULES.reportTTL && !reports.some((n) => n.id === r.id),
  );
  s.localReports.push(...reports);
  const home = w.locations.find((l) => l.id === s.homeId && l.owner === 'romulan' && l.hull > 0);
  const faction = w.factions.romulan;
  if (home && dist(s, home) < 240) {
    const received = s.localReports.filter((r) => w.time - r.seenAt < RULES.reportTTL);
    faction.reports = faction.reports.filter(
      (r) =>
        w.time - r.seenAt < RULES.reportTTL &&
        !received.some((n) => n.id === r.id && n.seenAt >= r.seenAt),
    );
    for (const r of received)
      if (!faction.reports.some((n) => n.id === r.id && n.seenAt >= r.seenAt))
        faction.reports.push(structuredClone(r));
  }
}
/** Orion decisions are coordinated by the independent faction controller. */
export function decideThreat(e: SimulationEngine, s: Enemy) {
  if (s.factionId === 'orion') {
    observeOrion(e);
    planOrion(e);
    return;
  }
  if (s.intent === 'docked' || e.state.time < s.nextDecision) return;
  const w = e.state,
    faction = w.factions.romulan,
    home = w.locations.find((l) => l.id === s.homeId && l.owner === 'romulan' && l.hull > 0);
  s.nextDecision = w.time + RULES.decisionInterval;
  gather(e, s);
  if (
    s.hull < capabilities(s).hull * 0.4 ||
    s.engines < 25 ||
    (s.role === 'warbird' &&
      (faction.stance === 'withdraw' ||
        (s.id === 'romulan-reserve' && !['reinforce', 'escalate'].includes(faction.stance))))
  ) {
    s.intent = 'retreat';
    s.targetId = null;
    s.destination = home ? { x: home.x, y: home.y } : null;
    return;
  }
  if (s.intent === 'retreat') return;
  if (s.role === 'scout') {
    if (
      home &&
      dist(s, home) > 240 &&
      s.localReports.some(
        (r) => r.value > 0 && !faction.reports.some((n) => n.id === r.id && n.seenAt >= r.seenAt),
      )
    ) {
      s.intent = 'retreat';
      s.destination = { x: home.x, y: home.y };
      return;
    }
    s.intent = 'observe';
    s.targetId = null;
    const traffic = [...s.localReports, ...faction.reports]
      .filter((r) => r.kind === 'ship' && w.time - r.seenAt < 30)
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0];
    const nodes = [
      { x: 690, y: 120 },
      { x: 740, y: -160 },
      { x: 650, y: 300 },
    ];
    if (traffic && traffic.value > 0) s.destination = { x: traffic.x, y: traffic.y };
    else {
      const i = s.visited.length % nodes.length;
      s.destination = nodes[i];
      if (dist(s, s.destination) < 30) s.visited.push(String(i));
    }
    return;
  }
  const candidates = faction.reports
    .filter((r) => w.time - r.seenAt < RULES.reportTTL)
    .map((r) => ({
      r,
      score:
        (r.value + w.tension * 9) * (1 - (w.time - r.seenAt) / RULES.reportTTL) -
        r.defense * 1.4 -
        dist(s, r) * 0.15,
    }))
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
  const best = candidates[0];
  if (
    best &&
    best.score > 15 &&
    ['probe', 'reinforce', 'escalate'].includes(faction.stance) &&
    best.r.x >= 650
  ) {
    s.targetId = best.r.id;
    s.destination = { x: best.r.x, y: best.r.y };
    s.intent = 'probe';
  } else {
    s.targetId = null;
    s.intent = w.tension > 15 ? 'patrol' : 'observe';
    s.destination = { x: 900, y: 150 };
  }
}
export function advanceEnemy(e: SimulationEngine, s: Enemy, dt: number) {
  if (s.factionId === 'orion') {
    advanceOrion(e, dt);
    return;
  }
  const w = e.state;
  regenerate(s, w.time, dt);
  if (advanceEvasion(e, s, dt)) return;
  decideThreat(e, s);
  const home = w.locations.find((l) => l.id === s.homeId && l.owner === 'romulan' && l.hull > 0);
  if (s.intent === 'retreat' || s.intent === 'docked') {
    if (!home) {
      s.intent = 'observe';
      s.targetId = null;
      return;
    }
    if (dist(s, home) > 15) {
      move(s, home, dt);
      return;
    }
    if (s.intent !== 'docked') {
      s.intent = 'docked';
      s.nextDecision = w.time + 10;
    }
    let material = home.stock.materials;
    const hull = Math.min(material, dt * 0.5, (capabilities(s).hull - s.hull) / 8);
    s.hull += hull * 8;
    material -= hull;
    for (const k of ['engines', 'weapons'] as const) {
      const repair = Math.min(100 - s[k], dt * 4, material * 8);
      s[k] += repair;
      material -= repair / 8;
    }
    home.stock.materials = Math.max(0, material);
    if (s.photon < capabilities(s).photon && home.stock.photon >= 1 && w.tick % 10 === 0) {
      home.stock.photon--;
      s.photon++;
    }
    if (
      w.time >= s.nextDecision &&
      s.hull >= capabilities(s).hull * 0.85 &&
      s.photon >= Math.min(2, capabilities(s).photon) &&
      s.core > capabilities(s).core * 0.7 &&
      s.engines >= 25
    ) {
      s.intent = 'observe';
      s.nextDecision = w.time + 5;
    }
    return;
  }
  const report = w.factions.romulan.reports.find((r) => r.id === s.targetId);
  const target =
    report &&
    ([...w.ships, ...w.civilians].find((t) => t.id === report.id) ||
      w.locations.find((l) => l.id === report.id && l.owner === 'starfleet'));
  const visible =
    !!target &&
    ('classId' in target
      ? canDetectShip(s, target, w.time)
      : dist(s, target) < capabilities(s).sensors);
  if (target && visible && s.intent === 'probe') {
    s.destination = { x: target.x, y: target.y };
    if (w.factions.romulan.stance === 'escalate') e.fire(s, target);
  }
  if (s.destination && (!target || !visible || dist(s, target) > 65)) move(s, s.destination, dt);
  const attacker = w.ships.find(
    (t) => t.id === s.lastAttackerId && w.time - s.attackedAt < 12 && canDetectShip(s, t, w.time),
  );
  if (attacker) e.fire(s, attacker);
}
export function advanceFactions(e: SimulationEngine, _dt: number) {
  const w = e.state;
  if (w.tick % 50 !== 0) return;
  const rom = w.factions.romulan,
    previous = rom.stance;
  const fresh = rom.reports.some((r) => w.time - r.seenAt < RULES.reportTTL && r.x >= 650);
  rom.stance = !fresh
    ? ['probe', 'reinforce', 'escalate', 'withdraw'].includes(previous)
      ? 'withdraw'
      : 'observe'
    : w.tension >= 65
      ? 'escalate'
      : w.tension >= 50
        ? 'reinforce'
        : w.tension >= 35
          ? 'probe'
          : w.tension >= 15
            ? 'patrol'
            : 'observe';
  if (['probe', 'reinforce'].includes(rom.stance)) {
    const intruder = rom.reports.find((r) => r.x >= 780 && w.ships.some((s) => s.id === r.id));
    if (intruder)
      createEvent(
        e,
        'diplomatic',
        intruder.id,
        'Romulan Warning：请撤离 Neutral Zone / Romulan territory',
      );
  }
  if (rom.stance === 'escalate' && previous !== 'escalate') {
    e.record('border', '收到 Romulan 军事升级声明', null);
    const assets = w.enemies.filter((s) => s.factionId === 'romulan' && s.role === 'warbird'),
      subject = rom.reports.filter((r) => r.x >= 650).sort((a, b) => b.seenAt - a.seenAt)[0];
    if (subject && assets.length)
      createEvent(
        e,
        'invasion',
        subject.id,
        'Border Command 基于真实边境报告派出现役军舰',
        assets.map((s) => s.id),
      );
    e.critical('escalation', subject?.id ?? w.commander.id, '收到 Romulan 军事升级声明');
  }
}
