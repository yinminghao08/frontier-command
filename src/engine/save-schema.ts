import { z } from 'zod';
const n = z.number().finite();
const nonnegative = n.min(0);
const id = z.string().min(1).max(100);
const nullableId = id.nullable();
const point = z.object({ x: n, y: n });
const ship = point.extend({
  id,
  name: z.string(),
  registry: z.string(),
  role: z.string(),
  operatorId: id,
  science: nonnegative.max(100),
  capacity: nonnegative,
  power: nonnegative,
  speed: nonnegative,
  hull: nonnegative.max(100),
  shield: nonnegative,
  maxShield: nonnegative,
  heading: n,
  throttle: nonnegative.max(1),
  status: z.enum(['docked', 'mission', 'returning', 'holding', 'disabled', 'repairing']),
  order: z.enum(['mission', 'hold', 'return', 'engage']),
  missionId: nullableId,
  targetId: nullableId,
  path: z.array(point).max(10),
  trail: z.array(point).max(40),
  cooldown: nonnegative,
  cargo: nonnegative,
  repair: n,
  tow: n,
  emergency: z.boolean(),
  helm: z.object({ turn: n.min(-1).max(1), throttle: n.min(-1).max(1) }),
});
const mission = z.object({
  id,
  name: z.string(),
  kind: z.enum(['explore', 'supply', 'patrol']),
  locationId: id,
  brief: z.string(),
  requirement: z.string(),
  attention: z.string(),
  risk: z.string(),
  duration: nonnegative,
  phase: z.enum([
    'available',
    'outbound',
    'working',
    'decision',
    'returning',
    'complete',
    'failed',
  ]),
  shipId: nullableId,
  route: z.enum(['safe', 'fast']),
  started: nonnegative,
  work: nonnegative,
  decisionAt: nonnegative,
  choice: z.enum(['remote', 'close']).nullable(),
  deadline: nonnegative,
  cargoRequired: nonnegative,
  settled: z.boolean(),
  run: nonnegative.int(),
  reward: nonnegative,
  result: z.string(),
  contactId: nullableId,
  damage: nonnegative,
});
export const worldSchema = z
  .object({
    version: z.literal(1),
    tick: nonnegative.int(),
    time: nonnegative,
    seed: nonnegative.int().max(4294967295),
    initialSeed: nonnegative.int().max(4294967295),
    paused: z.boolean(),
    speed: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    manualShipId: nullableId,
    commander: z.object({ id, name: z.string(), rank: z.string() }),
    operators: z
      .array(z.object({ id, shipId: id, kind: z.literal('rules'), name: z.string() }))
      .length(3),
    ships: z.array(ship).length(3),
    missions: z.array(mission).length(6),
    locations: z
      .array(
        point.extend({
          id,
          name: z.string(),
          label: z.string(),
          kind: z.enum(['base', 'colony', 'outpost', 'anomaly', 'border']),
          supply: nonnegative.max(100),
        }),
      )
      .length(8),
    contacts: z
      .array(
        point.extend({
          id,
          faction: z.enum(['klingon', 'romulan']),
          name: z.string(),
          detected: z.boolean(),
          identified: z.boolean(),
          hostile: z.boolean(),
          shield: nonnegative,
          hull: nonnegative,
          retreating: z.boolean(),
          missionId: nullableId,
          cooldown: nonnegative,
          created: nonnegative,
        }),
      )
      .max(20),
    resources: z.object({
      materials: nonnegative,
      supplies: nonnegative,
      science: nonnegative,
      allocation: nonnegative,
      intel: nonnegative,
    }),
    threat: nonnegative.max(100),
    logs: z
      .array(
        z.object({
          id: nonnegative.int(),
          time: nonnegative,
          level: z.enum(['info', 'success', 'warning', 'danger']),
          text: z.string(),
        }),
      )
      .max(180),
    nextLog: nonnegative.int(),
    nextContact: nonnegative.int(),
    nextIncursion: nonnegative,
    beams: z
      .array(z.object({ from: point, to: point, enemy: z.boolean(), expires: nonnegative }))
      .max(100),
  })
  .superRefine((w, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (w.time !== w.tick / 10) fail('Simulation time is inconsistent');
    for (const arr of [w.ships, w.missions, w.locations, w.operators, w.contacts])
      if (new Set(arr.map((a) => a.id)).size !== arr.length) fail('Duplicate IDs');
    if (w.manualShipId && !w.ships.some((s) => s.id === w.manualShipId))
      fail('Manual ship missing');
    if (w.manualShipId && w.speed !== 1) fail('Manual control requires 1x');
    for (const s of w.ships) {
      if (s.shield > s.maxShield || s.cargo > s.capacity) fail('Ship stats inconsistent');
      if (s.missionId && !w.missions.some((m) => m.id === s.missionId && m.shipId === s.id))
        fail('Ship mission missing');
      if (!w.operators.some((o) => o.id === s.operatorId && o.shipId === s.id))
        fail('Operator mismatch');
    }
    for (const m of w.missions) {
      if (!w.locations.some((l) => l.id === m.locationId)) fail('Mission location missing');
      if (m.shipId && !w.ships.some((s) => s.id === m.shipId)) fail('Mission ship missing');
      if (
        ['outbound', 'working', 'decision', 'returning'].includes(m.phase) &&
        !w.ships.some((s) => s.missionId === m.id && s.id === m.shipId)
      )
        fail('Active mission unassigned');
      if (['complete', 'failed', 'returning'].includes(m.phase) && !m.settled)
        fail('Settlement flag inconsistent');
      if (['available', 'outbound', 'working', 'decision'].includes(m.phase) && m.settled)
        fail('Active mission already settled');
    }
  });
