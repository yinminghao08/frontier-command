export const PHASE: Record<string, string> = {
  available: '等待派遣',
  outbound: '前往任务区',
  working: '执行中',
  decision: '等待调查决策',
  returning: '任务结算 · 返航',
  complete: '已完成',
  failed: '未完成',
};
export const STATUS: Record<string, string> = {
  docked: '停靠待命',
  mission: '行动中',
  returning: '返航中',
  holding: '保持位置',
  disabled: '失能 · 拖航中',
  repairing: '维修中',
};
export const KIND = { explore: '科学探索', supply: '后勤补给', patrol: '边境巡逻' };
export const time = (t: number) =>
  `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}`;
