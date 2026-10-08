import { FACILITIES } from './progression';
import { ORION_DEFENSES } from './orion';
import type { Location, ReadonlyDeep } from '../types';
export function facilityCapabilities(l: ReadonlyDeep<Pick<Location, 'kind' | 'defenseProfile'>>) {
  return l.defenseProfile ? ORION_DEFENSES[l.defenseProfile] : FACILITIES[l.kind];
}
