import { useState } from 'react';
import type { AgentCareer, Snapshot } from '../engine/types';
import { AGENT_RULES } from '../engine/definitions/agents';
import type { CommandSender } from './types';
import { LcarsButton, LcarsField, LcarsTextBar } from './components/Lcars';
import { WorkProgress } from './components/WorkProgress';
export function AgentTraining({ world, command }: { world: Snapshot; command: CommandSender }) {
  const [careers, setCareers] = useState<Record<string, AgentCareer>>({});
  const candidates = world.personnel.filter((p) => ['candidate', 'training'].includes(p.status));
  const cost = AGENT_RULES.recruitmentCredits + AGENT_RULES.trainingCredits;
  return (
    <section className="agent-training">
      <LcarsTextBar literal>COLONY ACADEMY / 智能体培养</LcarsTextBar>
      <p>
        录取 {AGENT_RULES.recruitmentCredits} + 训练 {AGENT_RULES.trainingCredits} Credits ·{' '}
        {AGENT_RULES.trainingMinutes} 游戏分钟 · 毕业后手动分配舰船
      </p>
      {!candidates.length && <p className="muted">殖民地指挥官尚未推荐新候选人。</p>}
      {candidates.map((p) => (
        <div key={p.id} className="record-row" data-candidate-id={p.id}>
          <b>
            {p.name} / {world.locations.find((l) => l.id === p.originId)?.name} /{' '}
            {p.status === 'candidate' ? 'CANDIDATE / 待录取' : 'TRAINING / 培养中'}
          </b>
          {p.status === 'candidate' ? (
            <>
              <LcarsField>
                培养方向
                <select
                  aria-label={'培养方向 ' + p.id}
                  value={careers[p.id] ?? 'logistics'}
                  onChange={(e) =>
                    setCareers((c) => ({ ...c, [p.id]: e.target.value as AgentCareer }))
                  }
                >
                  <option value="battle">BATTLE AGENT / 战斗</option>
                  <option value="logistics">LOGISTICS AGENT / 物流</option>
                </select>
              </LcarsField>
              <div className="inline-actions">
                <LcarsButton
                  disabled={world.resources.credits < cost}
                  onClick={() =>
                    command({
                      type: 'candidate',
                      personnelId: p.id,
                      accept: true,
                      career: careers[p.id] ?? 'logistics',
                    })
                  }
                >
                  接受并培养 / {cost} Credits
                </LcarsButton>
                <LcarsButton
                  tone="secondary"
                  onClick={() =>
                    command({
                      type: 'candidate',
                      personnelId: p.id,
                      accept: false,
                      career: careers[p.id] ?? 'logistics',
                    })
                  }
                >
                  拒绝候选
                </LcarsButton>
              </div>
            </>
          ) : (
            <WorkProgress
              label={(p.career === 'battle' ? 'BATTLE' : 'LOGISTICS') + ' AGENT'}
              work={p.training}
              duration={AGENT_RULES.trainingMinutes}
              paused={world.paused}
            />
          )}
        </div>
      ))}
    </section>
  );
}
