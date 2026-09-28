import { freezeDefinitions } from './freeze';

export const RESOURCE_DEFINITIONS = freezeDefinitions({
  materials: { label: '维修材料', initial: 100, resupplyAmount: 15, resupplyCap: 200 },
  supplies: { label: '补给库存', initial: 140, resupplyAmount: 45, resupplyCap: 300 },
  science: { label: '科研数据', initial: 0 },
  allocation: { label: '行动配额', initial: 120 },
  intel: { label: '巡逻情报', initial: 0 },
});
export type ResourceId = keyof typeof RESOURCE_DEFINITIONS;
export function initialResources(): Record<ResourceId, number> {
  return Object.fromEntries(
    Object.entries(RESOURCE_DEFINITIONS).map(([id, definition]) => [id, definition.initial]),
  ) as Record<ResourceId, number>;
}
