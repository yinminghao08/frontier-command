import type { Snapshot } from '../engine/types';
import type { CommandSender } from './types';
import { LcarsButton, LcarsMeter, LcarsTextBar } from './components/Lcars';
import { GOODS_LABELS } from './format';
const stages = {
  demand: '勒索通信',
  transferring: '有限交货',
  attacked: '遭袭 / 推进系统受威胁',
  boarding: '敌方登舰',
  resolved: '遭遇结果',
};
export function PiracyStatus({
  world,
  shipId,
  command,
}: {
  world: Snapshot;
  shipId: string;
  command: CommandSender;
}) {
  const incident = world.piracyIncidents.filter((i) => i.shipId === shipId).at(-1);
  if (!incident) return null;
  return (
    <section className="record-row" data-piracy-incident={incident.id} aria-label="海盗遭遇">
      <LcarsTextBar>ORION / {stages[incident.stage]}</LcarsTextBar>
      {incident.stage !== 'resolved' && (
        <p>
          要求至多 {incident.demand} 单位货物 · 响应剩余{' '}
          {Math.max(0, incident.deadline - world.time).toFixed(1)} 游戏分钟
        </p>
      )}
      {incident.stage === 'boarding' && (
        <LcarsMeter label="登舰准备" value={incident.boardingWork} max={4} />
      )}
      <p>
        {incident.response === 'pending'
          ? '按舰船交货策略评估'
          : incident.response === 'comply'
            ? '已同意有限交货'
            : '已拒绝勒索'}
        {incident.responseSource === 'admiral' ? ' / Admiral 覆盖' : ''}
      </p>
      {Object.entries(incident.lost)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => (
          <p key={k}>
            实际货损 {GOODS_LABELS[k as keyof typeof GOODS_LABELS]} {n.toFixed(1)}
          </p>
        ))}
      {incident.outcome && <p>{incident.outcome}</p>}
      {['demand', 'transferring'].includes(incident.stage) && (
        <div className="inline-actions">
          <LcarsButton
            onClick={() =>
              command({
                type: 'respondPiracy',
                incidentId: incident.id,
                shipId,
                response: 'comply',
              })
            }
          >
            同意有限交货
          </LcarsButton>
          <LcarsButton
            tone="danger"
            onClick={() =>
              command({
                type: 'respondPiracy',
                incidentId: incident.id,
                shipId,
                response: 'refuse',
              })
            }
          >
            拒绝勒索 / 中断交货
          </LcarsButton>
        </div>
      )}
      {world.escortRequests
        .filter((r) => r.targetShipId === shipId && r.kind === 'reinforce')
        .map((r) => (
          <p key={r.id}>
            救援协作 · {world.agents.find((a) => a.id === r.responderId)?.name} ·{' '}
            {r.status === 'accepted'
              ? r.rescueArrivedAt !== undefined
                ? '已到场，执行护航'
                : r.executionStarted
                  ? '已接受，实际航行增援'
                  : '已接受，等待执行'
              : r.status === 'completed'
                ? '已完成'
                : r.status === 'rejected'
                  ? '已拒绝'
                  : r.status === 'failed'
                    ? '未完成'
                    : '协商中'}
          </p>
        ))}
    </section>
  );
}
