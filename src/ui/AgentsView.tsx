import { useEffect, useState } from 'react';
import type { Agent, Snapshot, ReasoningEffort } from '../engine/types';
import type { AgentApiSettings } from '../engine/agent-api';
import type { CommandSender } from './types';
import { LcarsButton, LcarsField, LcarsMeter, LcarsTextBar } from './components/Lcars';
import { AgentTraining } from './AgentTraining';
import { EFFORT_LABELS } from './AgentApiSettings';
import { privateChannel } from '../engine/chat';
import { ACTION_LABELS } from './format';
import { AgentRequests } from './AgentRequests';
import { workWillingness } from '../engine/personality';
import { AgentCallStatus } from './AgentRuntime';
export const AGENT_STATUS: Record<Agent['status'], string> = {
  online: 'ONLINE / 在线',
  waiting: 'WAITING / 正在处理模型决策',
  executing: 'EXECUTING / 执行中',
  error: 'COMMS ERROR / 通讯错误',
  unassigned: 'UNASSIGNED / 待分配',
  admiral: 'ADMIRAL CONTROL / 司令指挥',
  offline: 'OFFLINE / 离线',
};
export function AgentsView({
  world,
  command,
  openChat,
}: {
  world: Snapshot;
  command: CommandSender;
  openChat: (channelId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [defaults, setDefaults] = useState<AgentApiSettings | null>(null);
  useEffect(() => {
    void window.frontier.agentSettings().then(setDefaults);
  }, []);
  const selected = world.agents.find((a) => a.id === selectedId);
  return (
    <div className="agents-workspace">
      {selected ? (
        <AgentDetail
          key={selected.id}
          agent={selected}
          world={world}
          command={command}
          defaults={defaults}
          back={() => setSelectedId(null)}
          openChat={openChat}
        />
      ) : (
        <>
          <p className="panel-intro">DAWN FRONTIER COMMAND / AUTONOMOUS OPERATORS</p>
          <p>职业决定专长与倾向。Admiral 随时拥有舰船最终指挥权。任务交流集中在通讯频道。</p>
          {(['battle', 'logistics'] as const).map((career) => (
            <section key={career} className="agent-roster">
              <LcarsTextBar literal>
                {career === 'battle' ? 'BATTLE / 战斗智能体' : 'LOGISTICS / 物流智能体'}
              </LcarsTextBar>
              <div className="agent-roster-heading" aria-hidden="true">
                <span>AGENT / 姓名</span>
                <span>VESSEL / 舰船</span>
                <span>STATE / 目标</span>
                <span>XP / 技能</span>
                <span>MODEL / 模型</span>
              </div>
              {world.agents
                .filter((a) => a.career === career)
                .map((a) => (
                  <LcarsButton
                    key={a.id}
                    shape="rail"
                    className="agent-roster-row"
                    data-agent-id={a.id}
                    onClick={() => setSelectedId(a.id)}
                    aria-label={'查看 Agent ' + a.name}
                  >
                    <strong>{a.name}</strong>
                    <span>
                      {world.ships.find((s) => s.id === a.assignedShipId)?.name ?? '待分配舰船'}
                    </span>
                    <span>
                      <b>{AGENT_STATUS[a.status]}</b>
                      <small>{a.currentGoal}</small>
                    </span>
                    <span>
                      {Math.floor(a.experience)} XP
                      <small>
                        B {a.skills.battle.toFixed(0)} / L {a.skills.logistics.toFixed(0)} / N{' '}
                        {a.skills.navigation.toFixed(0)}
                      </small>
                    </span>
                    <span>
                      {a.modelConfig.model ?? defaults?.defaultModel ?? '全局默认'}
                      <small>
                        {a.modelConfig.reasoningEffort ?? defaults?.reasoningEffort ?? '继承全局'}
                      </small>
                    </span>
                  </LcarsButton>
                ))}
              {!world.agents.some((a) => a.career === career) && (
                <p className="muted">此职业暂无 Agent。</p>
              )}
            </section>
          ))}
          <AgentTraining world={world} command={command} />
        </>
      )}
    </div>
  );
}
function AgentDetail({
  agent,
  world,
  command,
  defaults,
  back,
  openChat,
}: {
  agent: Snapshot['agents'][number];
  world: Snapshot;
  command: CommandSender;
  defaults: AgentApiSettings | null;
  back: () => void;
  openChat: (id: string) => void;
}) {
  const [shipId, setShipId] = useState(agent.assignedShipId ?? ''),
    [model, setModel] = useState(agent.modelConfig.model ?? '');
  const [effort, setEffort] = useState<ReasoningEffort | ''>(
      agent.modelConfig.reasoningEffort ?? '',
    ),
    [enabled, setEnabled] = useState(agent.enabled);
  const ship = world.ships.find((s) => s.id === agent.assignedShipId);
  const admiralTask = [...world.admiralTasks].reverse().find((t) => t.agentId === agent.id);
  return (
    <section className="agent-detail" data-agent-id={agent.id}>
      <div className="inline-actions">
        <LcarsButton tone="secondary" onClick={back}>
          返回 Agent 名册
        </LcarsButton>
        <LcarsButton onClick={() => openChat(privateChannel(agent.id))}>
          与 {agent.name} 私聊
        </LcarsButton>
        <LcarsButton
          onClick={() => command({ type: 'retryAgent', agentId: agent.id })}
          disabled={!agent.enabled}
        >
          再次决策
        </LcarsButton>
      </div>
      <LcarsTextBar literal>{agent.career.toUpperCase() + ' / ' + agent.name}</LcarsTextBar>
      <p className="agent-status-line">
        <b>{AGENT_STATUS[agent.status]}</b> · {agent.id}
      </p>
      <AgentCallStatus agentId={agent.id} status={agent.status} />
      <p>CURRENT GOAL / {agent.currentGoal}</p>
      <p>LONG TERM / {agent.longTermGoal.summary}</p>
      <p>
        任务意愿 {workWillingness(agent).toFixed(0)} / 100 · 偏好：
        {Object.entries(agent.taskPreferences)
          .sort(([, l], [, r]) => r - l)
          .map(([activity, value]) => `${activity} ${value.toFixed(0)}`)
          .join(' / ')}
      </p>
      <p>
        表达：{agent.profile.style} · 已获奖励 {agent.rewardCredits.toFixed(0)} Credits
      </p>
      <p>
        动机：安全 {agent.profile.motivations.safety} / 责任 {agent.profile.motivations.duty} / 收益{' '}
        {agent.profile.motivations.profit} / 成长 {agent.profile.motivations.growth} / 归属{' '}
        {agent.profile.motivations.belonging}
      </p>
      <AgentRequests world={world} command={command} agentId={agent.id} />
      {admiralTask && (
        <p className="agent-status-line">
          ADMIRAL CHAT / #{admiralTask.messageId} · {admiralTask.status.toUpperCase()} ·{' '}
          {admiralTask.kind === 'surveyRoute'
            ? `${admiralTask.sectorIndex}/${admiralTask.sectors.length} 星区`
            : admiralTask.kind.toUpperCase()}{' '}
          · {admiralTask.allowWormholes ? '允许已确认虫洞' : '禁止虫洞'}
          {admiralTask.reason ? ' · ' + admiralTask.reason : ''}
        </p>
      )}
      <p>
        当前任务：
        {ship?.current
          ? ACTION_LABELS[ship.current.action.type] +
            ' · ' +
            ship.current.note +
            ' · ' +
            ship.current.source.toUpperCase() +
            ' / ' +
            ship.current.actorId
          : '等待任务'}{' '}
        · {Math.floor(agent.experience)} XP
      </p>
      {agent.decision.lastError && <p className="api-test-error">{agent.decision.lastError}</p>}
      <LcarsTextBar literal>ATTRIBUTES / 状态与性格</LcarsTextBar>
      <div className="agent-attributes">
        {[
          ['Trust / 信任', agent.trust],
          ['Fatigue / 疲劳', agent.fatigue],
          ['Morale / 士气', agent.morale],
          ['Stress / 压力', agent.psychology.stress],
          ['Confidence / 信心', agent.psychology.confidence],
          ['Resentment / 不满', agent.psychology.resentment],
          ['Patience / 耐心', agent.profile.patience],
          ['Autonomy / 自主诉求', agent.profile.assertiveness],
          ['Sociability / 社交倾向', agent.profile.sociability],
          ['Risk Tolerance / 风险偏好', agent.personality.riskTolerance],
          ['Cooperation / 合作', agent.personality.cooperation],
          ['Discipline / 纪律', agent.personality.discipline],
          ['Ambition / 进取', agent.personality.ambition],
          ['Battle / 战斗技能', agent.skills.battle],
          ['Logistics / 物流技能', agent.skills.logistics],
          ['Navigation / 导航技能', agent.skills.navigation],
        ].map(([label, value]) => (
          <LcarsMeter key={label} label={String(label)} value={Number(value)} max={100} />
        ))}
      </div>
      <LcarsTextBar literal>ASSIGNMENT / 舰船</LcarsTextBar>
      <LcarsField>
        分配舰船
        <select
          aria-label="Agent 分配舰船"
          value={shipId}
          onChange={(e) => setShipId(e.target.value)}
        >
          <option value="">解除分配</option>
          {world.ships
            .filter(
              (s) => !world.agents.some((a) => a.id !== agent.id && a.assignedShipId === s.id),
            )
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} / {s.classId}
              </option>
            ))}
        </select>
      </LcarsField>
      <LcarsButton
        onClick={() => command({ type: 'assignAgent', agentId: agent.id, shipId: shipId || null })}
      >
        保存舰船分配
      </LcarsButton>
      <LcarsTextBar literal>MODEL CONFIGURATION / 独立模型设置</LcarsTextBar>
      <LcarsField>
        MODEL / 留空继承 {defaults?.defaultModel}
        <input
          aria-label="Agent 独立模型"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          maxLength={120}
        />
      </LcarsField>
      <LcarsField>
        REASONING
        <select
          aria-label="Agent 独立推理"
          value={effort}
          onChange={(e) => setEffort(e.target.value as typeof effort)}
        >
          <option value="">继承全局 / {defaults?.reasoningEffort}</option>
          {Object.entries(EFFORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </LcarsField>
      <LcarsField>
        <input
          aria-label="Agent 自主控制"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        AUTONOMOUS CONTROL / 自主控制
      </LcarsField>
      <LcarsButton
        onClick={() =>
          command({
            type: 'configureAgent',
            agentId: agent.id,
            modelConfig: { model: model.trim() || null, reasoningEffort: effort || null },
            enabled,
          })
        }
      >
        保存 Agent 模型
      </LcarsButton>
      <LcarsTextBar literal>RELATIONSHIPS / 关系</LcarsTextBar>
      {Object.entries(agent.relationships).map(([id, r]) => (
        <p key={id}>
          {world.agents.find((a) => a.id === id)?.name ?? id} · TRUST {r.trust.toFixed(0)} ·
          COOPERATION {r.cooperation.toFixed(0)}
          {' · '}
          {[...agent.memory].reverse().find((m) => m.entityId === id && m.kind === 'outcome')
            ?.summary ?? '尚无共同履约记录'}
        </p>
      ))}
      <LcarsTextBar literal>MEMORY / 有限记忆摘要</LcarsTextBar>
      {!agent.memory.length && <p className="muted">尚无记忆。</p>}
      {[...agent.memory].reverse().map((m) => (
        <div className="agent-memory-row" key={m.id}>
          <small>
            {m.time.toFixed(1)} MIN / {m.kind.toUpperCase()}
          </small>
          <p>{m.summary}</p>
        </div>
      ))}
    </section>
  );
}
