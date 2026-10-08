import { z } from 'zod';
import type { AgentRuntimeStats, AgentRequestTiming } from '../../src/engine/agent-api';
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
  private timings: AgentRequestTiming[] = [];
  track(agentId: string, kind: string, requestBytes: number, deadlineAt: number) {
    const timing: AgentRequestTiming = {
      id: this.counts.requests,
      agentId,
      kind,
      phase: 'requesting',
      startedAt: this.now(),
      deadlineAt,
      requestBytes,
      firstByteAt: null,
      endedAt: null,
      validationMs: 0,
      reason: null,
    };
    this.timings.push(timing);
    this.timings = [
      ...this.timings.filter((t) => t.endedAt === null),
      ...this.timings.filter((t) => t.endedAt !== null).slice(-20),
    ];
    return timing;
  }
  validation(agentId: string, milliseconds: number) {
    const timing = [...this.timings].reverse().find((t) => t.agentId === agentId);
    if (timing) timing.validationMs += milliseconds;
  }
  rejected(agentId: string, reason: string) {
    const timing = [...this.timings].reverse().find((t) => t.agentId === agentId);
    if (timing) {
      timing.phase = 'failed';
      timing.reason = reason.slice(0, 400);
    }
  }
  constructor(private readonly now = () => Date.now()) {}
  stats(): AgentRuntimeStats {
    this.recent = this.recent.filter((at) => this.now() - at < 60000);
    return {
      activeRequests: this.timings.filter((t) => t.endedAt === null).map((t) => ({ ...t })),
      recentRequests: this.timings
        .filter((t) => t.endedAt !== null)
        .slice(-20)
        .map((t) => ({ ...t })),
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
