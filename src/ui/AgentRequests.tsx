import type { Snapshot, TaskCondition } from '../engine/types';
import type { CommandSender } from './types';
import { LcarsButton, LcarsTextBar } from './components/Lcars';
import { ACTION_LABELS } from './format';
export function conditionText(c: Readonly<TaskCondition>, w: Snapshot) {
  const location =
    'locationId' in c ? (w.locations.find((l) => l.id === c.locationId)?.name ?? c.locationId) : '';
  return c.type === 'reward'
    ? `${c.credits} Credits 完成奖励`
    : c.type === 'rest'
      ? `${location} 连续休息 ${c.minutes} 分钟`
      : c.type === 'repair'
        ? `${location} 维修至 ${c.hullPercent}%`
        : `由 ${w.agents.find((a) => a.id === c.agentId)?.name ?? c.agentId} 护航`;
}
export function AgentRequests({
  world,
  command,
  agentId,
}: {
  world: Snapshot;
  command: CommandSender;
  agentId?: string;
}) {
  const tasks = world.admiralTasks.filter(
    (t) => ['active', 'blocked'].includes(t.status) && (!agentId || t.agentId === agentId),
  );
  const requests = world.escortRequests.filter(
    (r) =>
      ['pending', 'negotiating', 'awaitingApproval', 'accepted'].includes(r.status) &&
      (!agentId || r.requesterId === agentId || r.responderId === agentId),
  );
  return (
    <section className="agent-requests" aria-label="待处理请求">
      <LcarsTextBar literal>REQUESTS / 任务与协作</LcarsTextBar>
      {!tasks.length && !requests.length && <p className="muted">没有待处理的任务或协作请求。</p>}
      {[...tasks, ...requests].map((c) => {
        const task = 'consent' in c;
        const state = task ? (c.consent === 'accepted' ? c.status : c.consent) : c.status;
        const needsApproval = task
          ? c.consent === 'negotiating' ||
            (c.consent === 'accepted' &&
              c.conditions.some((c) => c.type === 'reward') &&
              !c.creditsApproved)
          : c.status === 'awaitingApproval';
        const name = (id: string) => world.agents.find((a) => a.id === id)?.name ?? 'Admiral';
        return (
          <article key={c.id} className="agent-request-row" data-request-id={c.id}>
            <strong>
              {task
                ? `Admiral → ${name(c.agentId)}`
                : `${name(c.requesterId)} → ${name(c.responderId)}`}{' '}
              · {state.toUpperCase()}
            </strong>
            <p>
              {task ? c.kind : c.kind.toUpperCase()} ·{' '}
              {c.action ? ACTION_LABELS[c.action.type] : '多步骤任务'}
              {!task && (
                <>
                  {' '}
                  · 条件版本 {c.conditionVersion} · 协商 {c.rounds}/2
                </>
              )}
            </p>
            {c.reason && <p>{c.reason}</p>}
            {c.conditions.map((condition, i) => (
              <p key={i}>
                {condition.when === 'before' ? '开始前' : '完成后'}：
                {conditionText(condition, world)}
              </p>
            ))}
            <div className="inline-actions">
              {needsApproval && (
                <LcarsButton
                  onClick={() =>
                    command({
                      type: 'resolveProposal',
                      contractId: c.id,
                      version: c.conditionVersion,
                      response: 'approve',
                    })
                  }
                >
                  确认条件与预算
                </LcarsButton>
              )}
              {task && c.controlMode !== 'direct' && (
                <LcarsButton
                  tone="danger"
                  onClick={() =>
                    command({
                      type: 'resolveProposal',
                      contractId: c.id,
                      version: c.conditionVersion,
                      response: 'takeover',
                    })
                  }
                >
                  直接接管
                </LcarsButton>
              )}
              <LcarsButton
                tone="secondary"
                onClick={() =>
                  command({
                    type: 'resolveProposal',
                    contractId: c.id,
                    version: c.conditionVersion,
                    response: 'cancel',
                  })
                }
              >
                取消安排
              </LcarsButton>
            </div>
          </article>
        );
      })}
      {world.commitments
        .filter((c) => (!agentId || c.agentId === agentId) && c.status === 'pending')
        .map((c) => (
          <p key={c.id} data-commitment-id={c.id}>
            {conditionText(c.condition, world)} ·{' '}
            {c.escrow > 0 ? `已托管 ${c.escrow} Credits` : '等待真实履约'}
          </p>
        ))}
    </section>
  );
}
