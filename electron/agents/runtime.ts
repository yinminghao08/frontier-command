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
  private nextTimingId = 1;
  private knownCostCny = 0;
  private unknownCostRequests = 0;
  private readonly agentCosts: Record<string, { known: number; unknown: number }> = {};
  track(agentId: string, kind: string, requestBytes: number, decisionStartedAt: number) {
    const timing: AgentRequestTiming = {
      id: this.nextTimingId++,
      agentId,
      kind,
      phase: 'requesting',
      startedAt: this.now(),
      decisionStartedAt,
      httpStatus: null,
      responseFormat: null,
      choiceCount: null,
      finishReason: null,
      failureKind: null,
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
    if (timing) {
      timing.validationMs += milliseconds;
      timing.validatedAt = this.now();
      timing.endedAt = timing.validatedAt;
    }
  }
  validating(agentId: string) {
    const timing = [...this.timings].reverse().find((t) => t.agentId === agentId);
    if (timing) {
      timing.phase = 'validating';
      timing.endedAt = null;
    }
  }
  validated(agentId: string) {
    const timing = [...this.timings].reverse().find((t) => t.agentId === agentId);
    if (timing) {
      timing.phase = 'completed';
      timing.endedAt = this.now();
    }
  }
  rejected(agentId: string, reason: string) {
    const timing = [...this.timings].reverse().find((t) => t.agentId === agentId);
    if (timing) {
      timing.phase = 'failed';
      timing.endedAt = this.now();
      timing.failureKind = 'validation';
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
      costCny: this.unknownCostRequests ? null : this.knownCostCny,
      knownCostCny: this.knownCostCny,
      unknownCostRequests: this.unknownCostRequests,
      byAgentCostCny: Object.fromEntries(
        Object.entries(this.agentCosts).map(([id, cost]) => [id, cost.unknown ? null : cost.known]),
      ),
    };
  }
  usage(value: unknown, timing?: AgentRequestTiming) {
    const metadata = z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
        prompt_cache_miss_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
        completion_tokens_details: z
          .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
          .optional(),
      })
      .safeParse(value);
    if (timing) {
      timing.inputTokens = metadata.success ? (metadata.data.prompt_tokens ?? null) : null;
      timing.outputTokens = metadata.success ? (metadata.data.completion_tokens ?? null) : null;
      timing.reasoningTokens = metadata.success
        ? (metadata.data.completion_tokens_details?.reasoning_tokens ?? null)
        : null;
      timing.cacheHitTokens = metadata.success
        ? (metadata.data.prompt_cache_hit_tokens ?? null)
        : null;
      timing.cacheMissTokens = metadata.success
        ? (metadata.data.prompt_cache_miss_tokens ?? null)
        : null;
    }
    const m = metadata.success ? metadata.data : undefined;
    const total =
      m?.total_tokens ??
      (m?.prompt_tokens !== undefined && m.completion_tokens !== undefined
        ? m.prompt_tokens + m.completion_tokens
        : undefined);
    if (total !== undefined) this.counts.tokens += total;
    else this.counts.unknownUsage++;
    const price = timing?.priceCny;
    let cost: number | null = null;
    if (price && m?.prompt_tokens !== undefined && m.completion_tokens !== undefined) {
      const hit =
        m.prompt_cache_hit_tokens ??
        (m.prompt_cache_miss_tokens !== undefined
          ? m.prompt_tokens - m.prompt_cache_miss_tokens
          : price.input === price.cacheHit
            ? 0
            : null);
      const miss = hit === null ? null : (m.prompt_cache_miss_tokens ?? m.prompt_tokens - hit);
      if (hit !== null && miss !== null && hit >= 0 && miss >= 0 && hit + miss === m.prompt_tokens)
        // Reasoning tokens are already included in completion_tokens.
        cost =
          (hit * price.cacheHit + miss * price.input + m.completion_tokens * price.output) /
          1000000;
    }
    if (timing) timing.costCny = cost;
    if (cost === null) this.unknownCostRequests++;
    else this.knownCostCny += cost;
    if (timing) {
      const account = (this.agentCosts[timing.agentId] ??= { known: 0, unknown: 0 });
      if (cost === null) account.unknown++;
      else account.known += cost;
    }
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
