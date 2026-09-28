import type { Location } from '../types';
import { freezeDefinitions } from './freeze';
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 800;
export const BASE = Object.freeze({ x: 260, y: 430 });
export const LOCATIONS = freezeDefinitions([
  { id: 'base', name: '曙光基地', label: 'DAWN STARBASE', kind: 'base', ...BASE, supply: 100 },
  {
    id: 'colony',
    name: '新曙殖民地',
    label: 'NEW HORIZON',
    kind: 'colony',
    x: 440,
    y: 660,
    supply: 30,
  },
  {
    id: 'outpost',
    name: '信标科研前哨',
    label: 'BEACON OUTPOST',
    kind: 'outpost',
    x: 780,
    y: 310,
    supply: 20,
  },
  {
    id: 'depot',
    name: '中继补给站',
    label: 'RELAY STATION',
    kind: 'outpost',
    x: 490,
    y: 430,
    supply: 80,
  },
  {
    id: 'anomaly1',
    name: '琥珀星云',
    label: 'AMBER NEBULA',
    kind: 'anomaly',
    x: 460,
    y: 200,
    supply: 0,
  },
  {
    id: 'anomaly2',
    name: '回声异常',
    label: 'ECHO ANOMALY',
    kind: 'anomaly',
    x: 750,
    y: 120,
    supply: 0,
  },
  {
    id: 'border1',
    name: '边境哨线 K-7',
    label: 'PATROL K-7',
    kind: 'border',
    x: 850,
    y: 550,
    supply: 0,
  },
  {
    id: 'border2',
    name: '静默走廊 R-3',
    label: 'SILENT CORRIDOR',
    kind: 'border',
    x: 930,
    y: 240,
    supply: 0,
  },
] satisfies Location[]);
