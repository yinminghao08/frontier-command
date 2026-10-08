import { z } from 'zod';
import { stockSchema, ammoSchema, pointSchema } from '../action-schema';
import { SHIP_CLASSES, type ShipClassId } from '../definitions/ships';
const nn = z.number().finite().min(0),
  n = z.number().finite(),
  id = z.string().min(1).max(160);
const classId = z.custom<ShipClassId>(
  (x) => typeof x === 'string' && Object.hasOwn(SHIP_CLASSES, x),
);
const report = pointSchema
  .extend({
    id,
    observerId: id,
    seenAt: nn,
    kind: z.enum(['ship', 'facility']),
    velocity: pointSchema,
    cargoEstimate: nn,
    value: nn,
    defense: nn,
    classId: classId.nullable(),
    escorts: z.array(pointSchema.extend({ id, strength: nn }).strict()).max(512),
  })
  .strict();
export const piracyIncidentSchema = z
  .object({
    id,
    shipId: id,
    created: nn,
    deadline: nn,
    demand: nn.int(),
    response: z.enum(['pending', 'comply', 'refuse']),
    responseSource: z.enum(['policy', 'admiral']).nullable(),
    stage: z.enum(['demand', 'transferring', 'attacked', 'boarding', 'resolved']),
    boardingWork: nn.max(4),
    lost: stockSchema,
    attackerIds: z.array(id),
    outcome: z.string(),
    notifiedAgentIds: z.array(id),
  })
  .strict();
export const orionSchema = z
  .object({
    intelligence: z.record(z.array(report).max(4096)),
    patrols: z.record(z.object({ anchor: pointSchema, leg: nn.int().max(33) }).strict()),
    operations: z.array(
      z
        .object({
          id,
          targetId: id,
          members: z
            .array(
              z
                .object({
                  shipId: id,
                  duty: z.enum(['intercept', 'flank', 'loot', 'cover', 'transport']),
                })
                .strict(),
            )
            .min(1)
            .max(24),
          phase: z.enum([
            'assemble',
            'deploy',
            'ambush',
            'extort',
            'disable',
            'board',
            'withdraw',
            'resupply',
          ]),
          status: z.enum(['active', 'complete', 'aborted']),
          created: nn,
          phaseAt: nn,
          report,
          motion: pointSchema.extend({ observedAt: nn }).strict(),
          rendezvous: pointSchema,
          intercept: pointSchema,
          incidentId: id.nullable(),
          work: nn,
          transferWork: nn,
          initialCargo: nn,
          limit: nn,
          taken: nn,
          reason: z.string(),
        })
        .strict(),
    ),
    jobs: z.array(
      z
        .object({
          id,
          kind: z.enum(['ship', 'ammo', 'supply', 'hq']),
          locationId: id.nullable(),
          builderId: id.nullable(),
          point: pointSchema,
          classId: classId.nullable(),
          work: nn,
          duration: nn.positive(),
          credits: nn,
          materials: nn,
          status: z.enum(['active', 'complete', 'lost']),
        })
        .strict(),
    ),
    logistics: z.array(
      z
        .object({
          shipId: id,
          sourceId: id,
          targetId: id,
          phase: z.enum(['loading', 'delivery']),
          work: nn,
          manifest: stockSchema,
        })
        .strict(),
    ),
    // Export rights can accumulate fractions; physical ammunition remains integral.
    servicedLoot: z.record(
      z.object({ materials: nn, photon: nn, quantum: nn, specialFinds: nn }).strict(),
    ),
    lootCargo: z.record(stockSchema),
    provisioning: z.array(
      z.object({ shipId: id, sourceId: id.nullable(), headquarters: z.boolean() }).strict(),
    ),
    robbedTargets: z.record(
      z.object({ cargoEstimate: nn, seenAt: nn, departed: z.boolean() }).strict(),
    ),
    nextPlan: nn,
    market: z.object({ credits: nn, stock: stockSchema, capacity: stockSchema }).strict(),
    realizedIncome: nn,
    ledger: z.array(
      z
        .object({
          id,
          time: nn,
          kind: z.string().min(1),
          entityId: id,
          credits: n,
          goods: stockSchema,
        })
        .strict(),
    ),
    shipLosses: z.array(
      z.object({ id, time: nn, cargo: stockSchema, ammunition: ammoSchema, classId }).strict(),
    ),
  })
  .strict();
