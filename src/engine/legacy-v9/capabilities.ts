import { SHIP_CLASSES, MODULE_SLOTS } from './ships';
import type { Ship, ReadonlyDeep } from '../types';
export function capabilities(s: ReadonlyDeep<Pick<Ship, 'classId' | 'modules' | 'engines'>>) {
  if (!Object.hasOwn(SHIP_CLASSES, s.classId)) throw Error('Unsupported legacy ship class');
  const id = s.classId as keyof typeof SHIP_CLASSES;
  const d = SHIP_CLASSES[id];
  return {
    ...d,
    moduleSlots: MODULE_SLOTS[id],
    cargo: d.cargo + (s.modules.includes('expandedCargo') ? 50 : 0),
    shield: d.shield * (s.modules.includes('reinforcedShields') ? 1.6 : 1),
    sensors: d.sensors * (s.modules.includes('longRangeSensors') ? 2 : 1),
    mining: Math.max(0.35, d.science / 45),
    hazardFactor: s.modules.includes('reinforcedShields') ? 0.4 : 1,
    warp: d.warp * Math.max(0.15, s.engines / 100),
  };
}
export const cargoUsed = (s: ReadonlyDeep<Pick<Ship, 'cargo' | 'passengers'>>) =>
  Object.values(s.cargo).reduce((a, b) => a + b, 0) + s.passengers / 5;
