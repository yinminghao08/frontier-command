import { z } from 'zod';
import type { AgentRuntimeStats } from '../../src/engine/agent-api';
export type RequestKind = 'initial' | 'repair' | 'compatibility' | 'test';

/** App-wide telemetry only. Requests never wait for application quotas or slots. */
export class RequestTracker {
  private recent: number[] = [];
  private active = 0;
  private disposed = false;
  private counts = {
    requests: 0,
    repairs: 0,
    cancellations: 0,
    failures: 0,
    tokens: 0,
    unknownUsage: 0,
  };
  private byAgent: Record<string, number> = {};
  constructor(private readonly now = () => Date.now()) {}
  stats(): AgentRuntimeStats {
    this.recent = this.recent.filter((at) => this.now() - at < 60000);
    return {
      concurrency: this.active,
      requests: this.counts.requests,
      repairs: this.counts.repairs,
      cancellations: this.counts.cancellations,
      failures: this.counts.failures,
      tokens: this.counts.unknownUsage ? null : this.counts.tokens,
      windowRequests: this.recent.length,
      byAgent: { ...this.byAgent },
    };
  }
  usage(value: unknown) {
    const parsed = z.object({ total_tokens: z.number().int().min(0) }).safeParse(value);
    if (parsed.success) this.counts.tokens += parsed.data.total_tokens;
    else this.counts.unknownUsage++;
  }
  failure() {
    this.counts.failures++;
  }
  cancellation() {
    this.counts.cancellations++;
  }
  acquire(agentId: string, kind: RequestKind, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted || this.disposed) return Promise.reject(Error('cancelled'));
    const now = this.now();
    this.recent = this.recent.filter((at) => now - at < 60000);
    this.recent.push(now);
    this.active++;
    this.counts.requests++;
    if (kind === 'repair') this.counts.repairs++;
    this.byAgent[agentId] = (this.byAgent[agentId] ?? 0) + 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      this.active--;
    });
  }
  dispose() {
    this.disposed = true;
  }
}
