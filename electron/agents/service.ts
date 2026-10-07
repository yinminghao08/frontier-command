import type { AgentControllerPort, Command, CommandResult, Snapshot } from '../../src/engine/types';
import { ChatCompletionsClient, AgentApiError } from './client';
import type { ConnectionConfig } from './config';
export interface DecisionHost {
  snapshot(): Snapshot;
  controllerPort(id: string): AgentControllerPort;
  command(command: Command, actorId: string): CommandResult;
}
/** No WorldState/engine reference is accessible to the model layer. */
export class AgentDecisionService {
  private readonly flights = new Map<string, { controller: AbortController; revision: number }>();
  private disposed = false;
  constructor(
    private readonly host: DecisionHost,
    private readonly config: () => ConnectionConfig,
    private readonly client = new ChatCompletionsClient(),
  ) {}
  dispose() {
    this.disposed = true;
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
  }
  pump() {
    if (this.disposed) return;
    const snapshot = this.host.snapshot();
    for (const [id, flight] of this.flights) {
      if (snapshot.agents.find((a) => a.id === id)?.decision.revision !== flight.revision) {
        flight.controller.abort();
        this.flights.delete(id);
      }
    }
    if (snapshot.status !== 'active') return;
    const config = this.config();
    for (const a of snapshot.agents) {
      if (this.flights.size >= 2) break;
      if (
        !a.enabled ||
        this.flights.has(a.id) ||
        !a.decision.pendingReasons.length ||
        snapshot.time < a.decision.nextAt
      )
        continue;
      if (!config.apiKey && a.status === 'offline') continue;
      if (
        snapshot.paused &&
        !a.decision.pendingReasons.some((r) => /^(chat:|manual|configuration)/.test(r))
      )
        continue;
      const observation = this.host.controllerPort(a.id).getObservation();
      if (!observation?.self) continue;
      const revision = observation.self.decision.revision;
      if (!config.apiKey) {
        if (a.status !== 'offline')
          this.host.command(
            {
              type: 'agentDecisionState',
              agentId: a.id,
              revision,
              state: 'offline',
              error: 'Agent API 未配置，请在控制台设置中配置后重试。',
            },
            a.id,
          );
        continue;
      }
      const controller = new AbortController();
      const started = this.host.command(
        { type: 'agentDecisionState', agentId: a.id, revision, state: 'waiting', error: null },
        a.id,
      );
      if (!started.ok) continue;
      this.flights.set(a.id, { controller, revision });
      void this.client
        .decide(config, observation, controller.signal)
        .then((decision) => {
          if (this.disposed || controller.signal.aborted) return;
          const current = this.host.controllerPort(a.id).getObservation();
          if (current?.self?.decision.revision !== revision) return;
          const result = this.host.command(
            { type: 'agentDecision', agentId: a.id, revision, decision },
            a.id,
          );
          if (!result.ok)
            this.host.command(
              {
                type: 'agentDecisionState',
                agentId: a.id,
                revision,
                state: 'error',
                error: '决策拒绝：' + result.reason,
              },
              a.id,
            );
        })
        .catch((error) => {
          if (!this.disposed && !controller.signal.aborted)
            this.host.command(
              {
                type: 'agentDecisionState',
                agentId: a.id,
                revision,
                state: 'error',
                error:
                  error instanceof AgentApiError ? error.message : '模型调用失败，请稍后重试。',
              },
              a.id,
            );
        })
        .finally(() => {
          if (this.flights.get(a.id)?.controller === controller) this.flights.delete(a.id);
        });
    }
  }
}
