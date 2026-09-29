import type { OperationOrder, Snapshot } from '../engine/types';
import { SHIP_CLASSES } from '../engine/definitions/ships';
import { RULES } from '../engine/definitions/rules';
import { dist } from '../engine/navigation';
export function actionProgress(
  world: Snapshot,
  o: OperationOrder,
): { text: string; fraction: number | null } {
  if (o.phase === 'complete') return { text: '返航完成', fraction: 1 };
  if (o.held) return { text: '暂停执行；行动期限仍计时', fraction: null };
  if (o.phase === 'decision') return { text: '等待调查方案', fraction: null };
  const ships = world.ships.filter((s) => s.orderId === o.id);
  const travel = Math.max(
    0,
    ...ships.map((s) => {
      let p = { x: s.x, y: s.y },
        length = 0;
      for (const next of s.path) {
        length += dist(p, next);
        p = next;
      }
      return length / SHIP_CLASSES[s.classId].warp;
    }),
  );
  if (travel > 1)
    return {
      text: (o.phase === 'returning' ? '返航' : '当前航段') + '约 ' + Math.ceil(travel) + 'm',
      fraction: null,
    };
  if (o.phase === 'returning') {
    const recovery = Math.max(0, ...ships.map((s) => s.service));
    return {
      text: recovery > 0 ? '等待拖航约 ' + Math.ceil(recovery) + 'm' : '正在停靠',
      fraction: null,
    };
  }
  const primary = world.ships.find((s) => s.id === o.shipIds[0])!;
  const total =
    o.kind === 'defense'
      ? o.duration
      : o.kind === 'transport'
        ? RULES.loadMinutes
        : (RULES.surveyMinutes * (o.approach === 'close' ? 1.3 : 1) * 70) /
          SHIP_CLASSES[primary.classId].science;
  return {
    text: '工作 ' + Math.floor(o.work) + ' / ' + Math.ceil(total) + 'm',
    fraction: Math.min(1, o.work / total),
  };
}
