import { useEffect, useState } from 'react';
import type { AgentRuntimeStats } from '../engine/agent-api';
import { LcarsTextBar } from './components/Lcars';
export function AgentCallStatus({ status, agentId }: { agentId: string; status: string }) {
  const [stats, setStats] = useState<AgentRuntimeStats | null>(null);
  useEffect(() => {
    if (status !== 'waiting') return;
    let mounted = true;
    const update = () =>
      void window.frontier.agentRuntime().then((s) => {
        if (mounted) setStats(s);
      });
    update();
    const timer = setInterval(update, 500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [agentId, status]);
  const current = stats?.activeRequests.find((r) => r.agentId === agentId);
  return status === 'waiting' ? (
    <span role="status">
      {current?.phase === 'validating'
        ? '正在校验回复'
        : current?.phase === 'receiving'
          ? '正在接收回复'
          : '正在等待模型回复'}
      {current
        ? ` · 已用 ${Math.max(0, (Date.now() - current.decisionStartedAt) / 1000).toFixed(1)} 秒`
        : ''}
    </span>
  ) : null;
}
export function AgentRuntime({ agentId }: { agentId?: string } = {}) {
  const [stats, setStats] = useState<AgentRuntimeStats | null>(null);
  useEffect(() => {
    let mounted = true;
    const update = () =>
      window.frontier.agentRuntime().then((value) => {
        if (mounted) setStats(value);
      });
    void update();
    const timer = setInterval(() => void update(), 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="agent-runtime" aria-label="模型调用统计">
      <LcarsTextBar literal>MODEL CALLS / 模型调用统计</LcarsTextBar>
      <p>本次运行统计包含连接测试与失败请求。JSON 校验失败仅手动重试；费用为人民币估算。</p>
      {stats && (
        <p data-testid="agent-usage">
          本次运行请求 {stats.requests} · 本分钟 {stats.windowRequests} · 纠错 {stats.repairs} ·
          取消 {stats.cancellations} · 错误 {stats.failures} · Token {stats.tokens ?? '未知'} ·
          当前并发 {stats.concurrency}
          {' · '}费用 ¥
          {(agentId ? stats.byAgentCostCny?.[agentId] : stats.costCny)?.toFixed(6) ?? '未知'}
          {!agentId &&
            !!stats.unknownCostRequests &&
            `（已知部分 ¥${(stats.knownCostCny ?? 0).toFixed(6)}；${stats.unknownCostRequests} 次价格或用量未知）`}
        </p>
      )}
      {[...(stats?.recentRequests ?? []), ...(stats?.activeRequests ?? [])]
        .filter((r) => !agentId || r.agentId === agentId)
        .slice(-3)
        .map((r) => (
          <p key={r.id}>
            #{r.id} · {r.kind} · {r.responseFormat ?? '—'} · HTTP {r.httpStatus ?? '—'} · {r.phase}{' '}
            · {r.requestBytes} bytes · 响应{' '}
            {r.firstByteAt ? ((r.firstByteAt - r.startedAt) / 1000).toFixed(2) : '—'} 秒 · 总耗时{' '}
            {r.endedAt ? ((r.endedAt - r.startedAt) / 1000).toFixed(2) : '—'} 秒 · 校验{' '}
            {r.validationMs} ms · 输入 {r.inputTokens ?? '未知'} / 输出 {r.outputTokens ?? '未知'} /
            推理 {r.reasoningTokens ?? '未知'} Token{r.failureKind ? ' · ' + r.failureKind : ''}
            {' · '}Cache hit {r.cacheHitTokens ?? '未知'} / miss {r.cacheMissTokens ?? '未知'}
            {' · '}费用 ¥{r.costCny?.toFixed(6) ?? '未知'}
            {r.effective && (
              <>
                <br />
                实际请求：{r.effective.provider} · {r.effective.model} · Thinking{' '}
                {r.effective.thinking.toUpperCase()}（选择 {r.effective.thinkingSource}） · Effort{' '}
                {r.effective.effort} · max_tokens {r.effective.maxTokens}
              </>
            )}
            {r.reason ? ' · ' + r.reason : ''}
          </p>
        ))}
      {!agentId &&
        Object.entries(stats?.byAgentCostCny ?? {}).map(([id, cost]) => (
          <p key={id}>
            {id} · 本次运行费用 ¥{cost?.toFixed(6) ?? '未知'}
          </p>
        ))}
    </section>
  );
}
