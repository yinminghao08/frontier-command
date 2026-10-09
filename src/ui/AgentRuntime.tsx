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
export function AgentRuntime() {
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
      <p>调用统计包含兼容、纠错及手动请求；应用内无分钟额度或全局并发上限。</p>
      {stats && (
        <p data-testid="agent-usage">
          本次运行请求 {stats.requests} · 本分钟 {stats.windowRequests} · 纠错 {stats.repairs} ·
          取消 {stats.cancellations} · 错误 {stats.failures} · Token {stats.tokens ?? '未知'} ·
          当前并发 {stats.concurrency}
        </p>
      )}
      {stats?.recentRequests.slice(-3).map((r) => (
        <p key={r.id}>
          #{r.id} · {r.kind} · {r.responseFormat ?? '—'} · HTTP {r.httpStatus ?? '—'} · {r.phase} ·{' '}
          {r.requestBytes} bytes · 响应{' '}
          {r.firstByteAt ? ((r.firstByteAt - r.startedAt) / 1000).toFixed(2) : '—'} 秒 · 总耗时{' '}
          {r.endedAt ? ((r.endedAt - r.startedAt) / 1000).toFixed(2) : '—'} 秒 · 校验{' '}
          {r.validationMs} ms · 输入 {r.inputTokens ?? '未知'} / 输出 {r.outputTokens ?? '未知'} /
          推理 {r.reasoningTokens ?? '未知'} Token{r.failureKind ? ' · ' + r.failureKind : ''}
          {r.reason ? ' · ' + r.reason : ''}
        </p>
      ))}
    </section>
  );
}
