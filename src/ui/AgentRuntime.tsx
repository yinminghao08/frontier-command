import { useEffect, useState } from 'react';
import type { AgentRuntimeStats } from '../engine/agent-api';
import { LcarsTextBar } from './components/Lcars';
export function AgentCallStatus({ status }: { agentId: string; status: string }) {
  return status === 'waiting' ? <p role="status">正在处理模型决策</p> : null;
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
    </section>
  );
}
