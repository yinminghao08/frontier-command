import { freezeDefinitions } from './freeze';
export const RESOURCE_DEFINITIONS = freezeDefinitions({
  supplies: { label: '补给', initial: 240, resupplyAmount: 70, resupplyCap: 500 },
  medical: { label: '医疗物资', initial: 100, resupplyAmount: 25, resupplyCap: 500 },
  materials: { label: '维修材料', initial: 100, resupplyAmount: 25, resupplyCap: 500 },
  science: { label: '科研数据', initial: 0 },
  allocation: { label: '行动配额', initial: 0 },
  intel: { label: '情报', initial: 0 },
});
export type ResourceId = keyof typeof RESOURCE_DEFINITIONS;
