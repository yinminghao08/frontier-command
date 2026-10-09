import { vesselAgent } from './assignment';
import { useState } from 'react';
import type { Snapshot } from '../engine/types';
import type { ObjectiveGoal, TaskStatus } from '../engine/agent-runtime/model';
import { terminalTask, objectiveGoalSchema } from '../engine/agent-runtime/model';
import { actionSchema } from '../engine/action-schema';
import type { CommandSender } from './types';
import { LcarsButton, LcarsDialog, LcarsField, LcarsTextBar } from './components/Lcars';
import { OrderComposer, type ComposerRequest } from './OrderComposer';
import { ACTION_LABELS } from './format';

const statuses: Record<TaskStatus, string> = {
  proposed: '等待同意',
  accepted: '已接受',
  running: '执行中',
  blocked: '阻塞',
  interrupted: '已中断',
  completed: '已核验完成',
  completed_partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
};
export function TaskCards({
  world,
  command,
  agentId,
}: {
  world: Snapshot;
  command: CommandSender;
  agentId?: string;
}) {
  const [composer, setComposer] = useState<ComposerRequest | null>(null),
    [editId, setEditId] = useState<string | null>(null),
    [history, setHistory] = useState(false),
    [error, setError] = useState('');
  const tasks = world.agentRuntime.tasks
    .filter(
      (t) =>
        !agentId ||
        t.ownerAgentId === agentId ||
        t.assignedShipIds.includes(
          world.assignments.find((a) => a.operatorId === agentId)?.shipId ?? '',
        ),
    )
    .filter((t) => history || !terminalTask(t.status));
  const edit = world.objectives.find((o) => o.id === editId);
  const execute = async (c: Parameters<CommandSender>[0]) => {
    const result = await command(c);
    setError(result.ok ? '' : result.reason);
  };
  return (
    <section className="task-cards" aria-label="持久任务">
      <LcarsTextBar literal>OBJECTIVES / 持久任务</LcarsTextBar>
      <LcarsButton tone="secondary" aria-pressed={history} onClick={() => setHistory((v) => !v)}>
        {history ? '显示当前目标' : '包含已结束目标'}
      </LcarsButton>
      {!tasks.length && <p className="muted">没有活跃目标。</p>}
      {tasks.map((task) => {
        const objective = world.objectives.find((o) => o.id === task.objectiveId);
        if (!objective) return null;
        const agent =
            world.agents.find((a) => a.id === task.ownerAgentId) ??
            vesselAgent(world, task.assignedShipIds[0]),
          ships = world.ships.filter((s) => task.assignedShipIds.includes(s.id));
        const current = ships
          .flatMap((s) => [s.current, ...s.queue])
          .find((d) => d?.taskId === task.taskId);
        const cargoKind =
          objective.goal.kind === 'loadReturn'
            ? objective.goal.cargoKind
            : objective.goal.kind === 'operation' && 'cargoKind' in objective.goal.action
              ? objective.goal.action.cargoKind
              : 'materials';
        const cargoLabel =
          cargoKind === 'materials'
            ? 'Materials'
            : cargoKind === 'photon'
              ? 'Photon'
              : cargoKind === 'quantum'
                ? 'Quantum'
                : 'Special Finds';
        const losses = Object.values(task.progress.lost).reduce((n, v) => n + v, 0),
          active = !terminalTask(task.status);
        return (
          <article
            key={task.taskId}
            className="task-card"
            data-task-id={task.taskId}
            data-objective-id={objective.id}
          >
            <LcarsTextBar literal>
              {(task.scheduling === 'queued' ? '已排队' : statuses[task.status]).toUpperCase() +
                ' / ' +
                (agent?.name ?? 'Admiral')}
            </LcarsTextBar>
            <p>
              <strong>{objective.originalInstruction || objective.completionCriteria}</strong>
            </p>
            <p>
              {ships.map((s) => s.name).join(' / ') || '未分配舰船'} · 授权{' '}
              {objective.controlMode === 'direct'
                ? 'Admiral 直接指挥'
                : objective.controlMode === 'autonomous'
                  ? '自主任务'
                  : '自愿任务'}{' '}
              · 修订 {objective.revision}
            </p>
            <p data-testid="task-step">
              当前步骤 {task.scheduling === 'queued' ? '等待前序指令 / ' : ''}
              {current
                ? ACTION_LABELS[current.action.type]
                : task.checkpoint
                  ? '保留执行进度，等待恢复'
                  : statuses[task.status]}{' '}
              · 已完成 {task.steps.filter((s) => s.status === 'completed').length} 步 / 历史{' '}
              {task.steps.length} 条
            </p>
            <p data-testid="task-cargo">
              {cargoLabel} 累计：装载 {task.progress.loaded[cargoKind].toFixed(1)} / 交付{' '}
              {task.progress.delivered[cargoKind].toFixed(1)} / 另处交付{' '}
              {task.progress.diverted[cargoKind].toFixed(1)} / 损失{' '}
              {task.progress.lost[cargoKind].toFixed(1)} · 来源{' '}
              {
                new Set(
                  task.completionEvidence
                    .filter((p) => p.kind === 'loaded' && p.sourceId)
                    .map((p) => p.sourceId),
                ).size
              }
            </p>
            {task.scope.revision > 0 && (
              <p data-testid="task-revision-cargo">
                本次修订：保留货物 {task.scope.carryIn[cargoKind].toFixed(1)} / 新装载{' '}
                {(task.progress.loaded[cargoKind] - task.scope.loadedBaseline[cargoKind]).toFixed(
                  1,
                )}{' '}
                / 新交付{' '}
                {(
                  task.progress.delivered[cargoKind] - task.scope.deliveredBaseline[cargoKind]
                ).toFixed(1)}{' '}
                / 新损失{' '}
                {(task.progress.lost[cargoKind] - task.scope.lostBaseline[cargoKind]).toFixed(1)}
              </p>
            )}
            {!active && objective.reason && <p>{objective.reason}</p>}
            {task.blockReason && (
              <p className="api-test-error" data-testid="task-block">
                {task.blockReason}
              </p>
            )}
            <p>
              风险：
              {losses > 0
                ? '存在已确认货损'
                : ships.some((s) =>
                      world.contacts.some(
                        (c) => c.live && c.hostile && Math.hypot(c.x - s.x, c.y - s.y) < 240,
                      ),
                    )
                  ? '附近已确认敌对接触'
                  : '当前公开观察未确认紧迫威胁'}
            </p>
            {active && (
              <div className="inline-actions">
                {task.status === 'interrupted' && (
                  <LcarsButton
                    onClick={() =>
                      void execute({
                        type: 'resumeObjective',
                        objectiveId: objective.id,
                        expectedRevision: objective.revision,
                      })
                    }
                  >
                    显式恢复
                  </LcarsButton>
                )}
                {['operation', 'loadReturn', 'recovery'].includes(objective.goal.kind) && (
                  <LcarsButton
                    tone="secondary"
                    onClick={() => {
                      if (objective.goal.kind === 'operation')
                        setComposer({
                          action: actionSchema.parse(objective.goal.action),
                          shipId: task.assignedShipIds[0],
                          objectiveId: objective.id,
                        });
                      else setEditId(objective.id);
                    }}
                  >
                    修改目标
                  </LcarsButton>
                )}
                <LcarsButton
                  tone="danger"
                  onClick={() =>
                    void execute({
                      type: 'cancelObjective',
                      objectiveId: objective.id,
                      expectedRevision: objective.revision,
                    })
                  }
                >
                  取消目标
                </LcarsButton>
              </div>
            )}
            <details>
              <summary>步骤历史与完成证据</summary>
              {task.steps.map((step, i) => (
                <p key={i}>
                  {i + 1}. {step.label} · {step.status}
                </p>
              ))}
              {objective.amendments.map((a) => (
                <p key={'revision:' + a.revision}>
                  修订 {a.revision} / {a.instruction}
                </p>
              ))}
              {task.completionEvidence.map((proof, i) => (
                <p key={proof.eventId + ':' + i}>
                  #{proof.tick} · {proof.description}
                  {proof.cargoKind
                    ? ' / ' + proof.cargoKind + ' ' + proof.amount.toFixed(1)
                    : ''} · {proof.eventId}
                </p>
              ))}
              {!task.completionEvidence.length && <p>尚无完成证据。</p>}
            </details>
          </article>
        );
      })}
      {error && <p role="alert">{error}</p>}
      {composer && (
        <OrderComposer
          world={world}
          command={command}
          request={composer}
          onClose={() => setComposer(null)}
        />
      )}
      {edit && (
        <LogisticsRevision
          key={edit.id}
          world={world}
          objective={edit}
          command={command}
          close={() => setEditId(null)}
        />
      )}
    </section>
  );
}
function LogisticsRevision({
  world,
  objective,
  command,
  close,
}: {
  world: Snapshot;
  objective: Snapshot['objectives'][number];
  command: CommandSender;
  close: () => void;
}) {
  const [destination, setDestination] = useState(
      'destinationId' in objective.goal ? (objective.goal.destinationId ?? '') : '',
    ),
    [deliver, setDeliver] = useState(
      objective.goal.kind === 'loadReturn' && objective.goal.deliver,
    ),
    [route, setRoute] = useState<'safe' | 'direct' | 'risky'>(
      objective.goal.kind === 'loadReturn' ? objective.goal.route : 'safe',
    ),
    [error, setError] = useState('');
  const submit = async () => {
    const goal: ObjectiveGoal = objectiveGoalSchema.parse(
      objective.goal.kind === 'loadReturn'
        ? { ...objective.goal, destinationId: destination, deliver, route }
        : objective.goal.kind === 'recovery'
          ? { ...objective.goal, destinationId: destination || null }
          : objective.goal,
    );
    const result = await command({
      type: 'reviseObjective',
      objectiveId: objective.id,
      expectedRevision: objective.revision,
      goal,
      instruction: 'Admiral 修订交付目的地与返航要求',
    });
    if (result.ok) close();
    else setError(result.reason);
  };
  return (
    <LcarsDialog label="修改完整目标" title="REVISE OBJECTIVE / 修改完整目标" onClose={close}>
      <p>当前已装货物、来源责任和历史继续保留。自愿任务需要重新同意；中断目标需要显式恢复。</p>
      <LcarsField>
        DESTINATION / 目的地
        <select
          aria-label="任务目的地"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          {objective.goal.kind === 'recovery' && <option value="">留在舰上</option>}
          {world.locations
            .filter((l) => l.owner === 'starfleet' && l.hull > 0)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </LcarsField>
      {objective.goal.kind === 'loadReturn' && (
        <>
          <LcarsField>
            <input
              type="checkbox"
              checked={deliver}
              onChange={(e) => setDeliver(e.target.checked)}
            />
            返航后实际卸货交付
          </LcarsField>
          <LcarsField>
            ROUTE / 航线
            <select value={route} onChange={(e) => setRoute(e.target.value as typeof route)}>
              <option value="safe">SAFE</option>
              <option value="direct">DIRECT</option>
              <option value="risky">RISKY</option>
            </select>
          </LcarsField>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="inline-actions">
        <LcarsButton onClick={() => void submit()}>提交目标修订</LcarsButton>
        <LcarsButton tone="secondary" onClick={close}>
          返回
        </LcarsButton>
      </div>
    </LcarsDialog>
  );
}
