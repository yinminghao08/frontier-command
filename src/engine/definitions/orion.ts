import { freezeDefinitions } from './freeze';
import type { ShipClassId } from './ships';
export const ORION_RULES = freezeDefinitions({
  communicationRange: 360,
  reportTTL: 100,
  tacticalTTL: 12,
  planMinutes: 5,
  escortRange: 180,
  escortRiskRatio: 0.65,
  shipRiskRatio: 1.55,
  facilityRiskRatio: 0.85,
  watchBuffer: 40,
  minimumCargo: 20,
  minimumScore: 30,
  demandMinutes: 8,
  demandFraction: 0.25,
  boardingFraction: 0.5,
  boardingMinutes: 4,
  transferRate: 30,
  transferRange: 18,
  dockingRange: 15,
  fleetLimit: 24,
  supplyLimit: 4,
  repairReserve: 35,
  budgetReserve: 150,
  marketPrices: { materials: 5, photon: 12, quantum: 24, specialFinds: 150 },
  supplyCost: { credits: 300, materials: 80, minutes: 45 },
  hqCost: { credits: 800, materials: 180, minutes: 120 },
});
export const ORION_BUILDS = freezeDefinitions({
  orionScout: { credits: 100, materials: 18, minutes: 25, role: 'scout', desired: 2 },
  orionRaider: { credits: 160, materials: 28, minutes: 35, role: 'raider', desired: 4 },
  orionInterceptor: { credits: 190, materials: 32, minutes: 40, role: 'interceptor', desired: 2 },
  orionCorsair: { credits: 620, materials: 95, minutes: 90, role: 'corsair', desired: 1 },
  orionSmuggler: { credits: 280, materials: 45, minutes: 55, role: 'smuggler', desired: 1 },
} as const satisfies Partial<
  Record<
    ShipClassId,
    { credits: number; materials: number; minutes: number; role: string; desired: number }
  >
>);
export type OrionClassId = keyof typeof ORION_BUILDS;
export const ORION_DEFENSES = freezeDefinitions({
  orionHQ: { hull: 1800, shield: 1100, damage: 28, range: 180 },
  orionSupply: { hull: 650, shield: 360, damage: 12, range: 125 },
});
