import type { GeographicLocation as Location } from '../types';
import { freezeDefinitions } from './freeze';
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 800;
export const BASE = Object.freeze({ x: 880, y: 430 });
// Shared chart geometry: navigation and renderer use the same border polylines.
export const FEDERATION_EDGE = [
  { x: 1000, y: 0 },
  { x: 1080, y: 180 },
  { x: 1000, y: 350 },
  { x: 1100, y: 530 },
  { x: 1030, y: 800 },
];
export const ROMULAN_EDGE = [
  { x: 1250, y: 0 },
  { x: 1330, y: 180 },
  { x: 1240, y: 350 },
  { x: 1330, y: 530 },
  { x: 1250, y: 800 },
];
export function edgeAt(edge: readonly { x: number; y: number }[], y: number) {
  const i = Math.max(
    0,
    edge.findIndex((_p, j) => j < edge.length - 1 && y <= edge[j + 1].y),
  );
  const a = edge[i],
    b = edge[i + 1];
  return a.x + (b.x - a.x) * Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
}
export const REGIONS = freezeDefinitions([
  {
    id: 'rear',
    label: 'FEDERATION SPACE',
    color: '#8899ff',
    labelPoint: { x: 290, y: 60 },
    points: [
      { x: 0, y: 0 },
      { x: 620, y: 0 },
      { x: 570, y: 390 },
      { x: 650, y: 800 },
      { x: 0, y: 800 },
    ],
  },
  {
    id: 'frontier',
    label: 'DAWN FRONTIER',
    color: '#ffcc99',
    labelPoint: { x: 810, y: 65 },
    points: [{ x: 620, y: 0 }, ...FEDERATION_EDGE, { x: 650, y: 800 }, { x: 570, y: 390 }],
  },
  {
    id: 'neutral',
    label: 'NEUTRAL ZONE',
    color: '#cc99cc',
    labelPoint: { x: 1170, y: 90 },
    points: [...FEDERATION_EDGE, ...[...ROMULAN_EDGE].reverse()],
  },
  {
    id: 'romulan',
    label: 'ROMULAN FRONTIER',
    color: '#cc6666',
    labelPoint: { x: 1450, y: 60 },
    points: [...ROMULAN_EDGE, { x: 1600, y: 800 }, { x: 1600, y: 0 }],
  },
]);
export function regionAt(x: number, y = 400): Location['regionId'] {
  return x < edgeAt(FEDERATION_EDGE, y)
    ? 'federation'
    : x < edgeAt(ROMULAN_EDGE, y)
      ? 'neutral'
      : 'romulan';
}
export const TRANSPORT_LINKS = freezeDefinitions([
  ['rear-supply', 'depot'],
  ['depot', 'base'],
  ['depot', 'colony'],
  ['depot', 'anomaly1'],
  ['base', 'outpost'],
  ['base', 'mine'],
  ['mine', 'colony'],
  ['outpost', 'border2'],
  ['outpost', 'anomaly2'],
  ['anomaly2', 'planet'],
  ['base', 'border1'],
  ['border1', 'neutral-border'],
  ['border2', 'neutral-border'],
  ['neutral-border', 'romulan-colony'],
]);
export const LOCATIONS = freezeDefinitions([
  {
    id: 'rear-supply',
    name: '联邦后方补给港',
    label: 'FEDERATION SUPPLY',
    kind: 'outpost',
    regionId: 'federation',
    x: 160,
    y: 430,
    supply: 200,
  },
  {
    id: 'base',
    name: '曙光基地',
    label: 'DAWN STARBASE',
    kind: 'base',
    regionId: 'federation',
    ...BASE,
    supply: 100,
  },
  {
    id: 'colony',
    name: '新曙殖民地',
    label: 'NEW HORIZON',
    kind: 'colony',
    regionId: 'federation',
    x: 440,
    y: 660,
    supply: 30,
  },
  {
    id: 'outpost',
    name: '信标科研前哨',
    label: 'BEACON OUTPOST',
    kind: 'outpost',
    regionId: 'federation',
    x: 780,
    y: 310,
    supply: 20,
  },
  {
    id: 'depot',
    name: '中继补给站',
    label: 'RELAY STATION',
    kind: 'outpost',
    regionId: 'federation',
    x: 490,
    y: 430,
    supply: 80,
  },
  {
    id: 'anomaly1',
    name: '琥珀星云',
    label: 'AMBER NEBULA',
    kind: 'anomaly',
    regionId: 'federation',
    x: 460,
    y: 200,
    supply: 0,
  },
  {
    id: 'anomaly2',
    name: '回声异常',
    label: 'ECHO ANOMALY',
    kind: 'anomaly',
    regionId: 'federation',
    x: 750,
    y: 120,
    supply: 0,
  },
  {
    id: 'border1',
    name: '边境哨线 K-7',
    label: 'PATROL K-7',
    kind: 'border',
    regionId: 'federation',
    x: 850,
    y: 550,
    supply: 0,
  },
  {
    id: 'border2',
    name: '静默走廊 R-3',
    label: 'SILENT CORRIDOR',
    kind: 'border',
    regionId: 'federation',
    x: 930,
    y: 240,
    supply: 0,
  },
  {
    id: 'mine',
    name: '赫利俄斯矿场',
    label: 'HELIOS MINE',
    kind: 'mine',
    regionId: 'federation',
    x: 650,
    y: 600,
    supply: 0,
  },
  {
    id: 'planet',
    name: '翠绿星 · M级',
    label: 'VERDANT / M-CLASS',
    kind: 'planet',
    regionId: 'federation',
    x: 620,
    y: 100,
    supply: 0,
  },
  {
    id: 'neutral-border',
    name: '中立区界标',
    label: 'NEUTRAL WAYPOINT',
    kind: 'border',
    regionId: 'neutral',
    x: 1160,
    y: 630,
    supply: 0,
  },
  {
    id: 'romulan-colony',
    name: '罗慕兰殖民地',
    label: 'ROMULAN COLONY',
    kind: 'colony',
    regionId: 'romulan',
    x: 1430,
    y: 400,
    supply: 0,
  },
] satisfies Location[]);
