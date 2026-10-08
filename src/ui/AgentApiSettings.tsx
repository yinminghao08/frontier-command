import { useEffect, useRef, useState } from 'react';
import type { AgentApiInput, AgentApiSettings } from '../engine/agent-api';
import type { ReasoningEffort } from '../engine/types';
import { LcarsButton, LcarsField, LcarsPanel } from './components/Lcars';
import { AgentRuntime } from './AgentRuntime';
export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'NONE / 非推理参数模式',
  low: 'LOW / 低',
  medium: 'MEDIUM / 中',
  high: 'HIGH / 高',
};
export function AgentApiSettingsPanel() {
  const [stored, setStored] = useState<AgentApiSettings | null>(null);
  const [draft, setDraft] = useState<AgentApiInput>({
    baseUrl: '',
    defaultModel: '',
    reasoningEffort: 'none',
  });
  const [key, setKey] = useState(''),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; reason: string } | null>(null);
  const testRequest = useRef<string | null>(null);
  useEffect(() => {
    void window.frontier.agentSettings().then((settings) => {
      setStored(settings);
      setDraft({
        baseUrl: settings.baseUrl,
        defaultModel: settings.defaultModel,
        reasoningEffort: settings.reasoningEffort,
      });
    });
  }, []);
  useEffect(
    () => () => {
      if (testRequest.current) void window.frontier.cancelAgentApiTest(testRequest.current);
    },
    [],
  );
  const input = (): AgentApiInput => ({ ...draft, ...(key ? { apiKey: key } : {}), clearKey });
  const run = async (test: boolean) => {
    setBusy(true);
    setResult(null);
    const requestId = test ? crypto.randomUUID() : null;
    testRequest.current = requestId;
    try {
      const r = await (test
        ? window.frontier.testAgentApi(input(), requestId!)
        : window.frontier.configureAgentApi(input()));
      setResult(r);
      if (r.ok && !test) {
        setStored(await window.frontier.agentSettings());
        setKey('');
        setClearKey(false);
      }
    } catch {
      setResult({ ok: false, reason: 'API 设置服务不可用，请稍后重试。' });
    } finally {
      testRequest.current = null;
      setBusy(false);
    }
  };
  return (
    <LcarsPanel title="AGENT API / 模型连接" className="agent-api-settings">
      <p>OPENAI COMPATIBLE / CHAT COMPLETIONS</p>
      <LcarsField>
        BASE URL
        <input
          aria-label="Agent API Base URL"
          value={draft.baseUrl}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
          placeholder="https://api.openai.com/v1"
        />
      </LcarsField>
      <LcarsField>
        API KEY / {stored?.hasKey ? '已加密保存；留空保留' : '尚未配置'}
        <input
          aria-label="Agent API Key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          disabled={busy}
          onChange={(e) => setKey(e.target.value)}
        />
      </LcarsField>
      {stored?.hasKey && (
        <LcarsField>
          <input
            type="checkbox"
            checked={clearKey}
            disabled={busy}
            onChange={(e) => setClearKey(e.target.checked)}
          />
          清除已保存 Key
        </LcarsField>
      )}
      <LcarsField>
        DEFAULT MODEL / 默认模型
        <input
          aria-label="Agent 默认模型"
          value={draft.defaultModel}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, defaultModel: e.target.value }))}
        />
      </LcarsField>
      <LcarsField>
        REASONING EFFORT / 默认推理
        <select
          aria-label="Agent 默认推理"
          value={draft.reasoningEffort}
          disabled={busy}
          onChange={(e) =>
            setDraft((d) => ({ ...d, reasoningEffort: e.target.value as ReasoningEffort }))
          }
        >
          {Object.entries(EFFORT_LABELS).map(([effort, label]) => (
            <option key={effort} value={effort}>
              {label}
            </option>
          ))}
        </select>
      </LcarsField>
      <p className="muted">
        NONE 不发送 reasoning_effort。Provider 拒绝推理参数时自动省略并重试。Key
        通过系统加密独立保存。
      </p>
      <div className="inline-actions">
        <LcarsButton disabled={busy || !stored} onClick={() => void run(false)}>
          保存 Agent API
        </LcarsButton>
        {busy && testRequest.current && (
          <LcarsButton
            tone="secondary"
            onClick={() => {
              if (testRequest.current) void window.frontier.cancelAgentApiTest(testRequest.current);
            }}
          >
            取消连接测试
          </LcarsButton>
        )}
        <LcarsButton tone="secondary" disabled={busy || !stored} onClick={() => void run(true)}>
          {busy ? 'CONNECTING / 测试中…' : '测试 API 连接'}
        </LcarsButton>
      </div>
      {result && (
        <p role="status" className={result.ok ? 'api-test-success' : 'api-test-error'}>
          {result.reason}
        </p>
      )}
      <AgentRuntime />
    </LcarsPanel>
  );
}
