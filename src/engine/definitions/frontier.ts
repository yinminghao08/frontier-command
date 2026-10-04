import type { FacilityKind, StandingOrders, Stock } from '../types';
import { freezeDefinitions } from './freeze';
const stock = (
  materials: number,
  supplies: number,
  photon: number,
  quantum: number,
  specialFinds: number,
): Stock => ({ materials, supplies, photon, quantum, specialFinds });
export const STORAGE = freezeDefinitions({
  base: stock(6000, 3000, 500, 200, 50),
  mine: stock(600, 120, 30, 10, 10),
  colony: stock(300, 300, 40, 10, 20),
  outpost: stock(250, 120, 60, 20, 10),
  platform: stock(150, 100, 80, 30, 10),
} satisfies Record<FacilityKind, Stock>);
export const MAINTENANCE = freezeDefinitions({
  base: 0,
  colony: 0,
  mine: 0.5,
  outpost: 0.4,
  platform: 0.6,
});
export const DEFAULT_STANDING: StandingOrders = Object.freeze({
  roe: 'RETURN FIRE',
  retreatHull: 30,
  retreatShield: 15,
  retreatCore: 10,
  photonThreshold: 20,
  quantumThreshold: 20,
  maxPursuit: 150,
  allowNeutral: false,
  allowRomulan: false,
  autoEscort: false,
  respondDistress: false,
  protectCivilian: false,
  protectFreighter: false,
  protectColony: false,
  autoResupply: false,
  idle: 'return',
});
export const CAREER_LABELS = freezeDefinitions({
  battle: '战术',
  science: '科研',
  diplomacy: '外交',
  logistics: '物流',
  security: '安全',
  commander: '殖民地指挥',
});
export const TRADE_PRICES = freezeDefinitions({
  materials: { buy: 12, sell: 5 },
  supplies: { buy: 6, sell: 4 },
  photon: { buy: 18, sell: 12 },
  quantum: { buy: 36, sell: 24 },
  specialFinds: { buy: 0, sell: 150 },
});
export const DEVELOPMENT = freezeDefinitions({ credits: 60, materials: 10, minutes: 30 });
