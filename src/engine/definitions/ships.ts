import { freezeDefinitions } from './freeze';
export interface ShipClassDefinition {
  science: number;
  capacity: number;
  power: number;
  speed: number;
  maxShield: number;
}
export const SHIP_CLASSES = freezeDefinitions({
  explorer: { science: 90, capacity: 20, power: 9, speed: 5.4, maxShield: 80 },
  transport: { science: 45, capacity: 60, power: 7, speed: 4.7, maxShield: 100 },
  patrol: { science: 60, capacity: 25, power: 18, speed: 6.3, maxShield: 140 },
} satisfies Record<string, ShipClassDefinition>);
export type ShipClassId = keyof typeof SHIP_CLASSES;
export const INITIAL_FLEET = freezeDefinitions([
  {
    id: 'verity',
    name: 'USS VERITY',
    registry: 'NCC-78231',
    role: '探索舰 · 明理号',
    classId: 'explorer',
    factionId: 'starfleet',
  },
  {
    id: 'meridian',
    name: 'USS MERIDIAN',
    registry: 'NCC-78232',
    role: '补给舰 · 子午号',
    classId: 'transport',
    factionId: 'starfleet',
  },
  {
    id: 'vigil',
    name: 'USS VIGIL',
    registry: 'NCC-78233',
    role: '巡逻舰 · 守望号',
    classId: 'patrol',
    factionId: 'starfleet',
  },
] as const);
