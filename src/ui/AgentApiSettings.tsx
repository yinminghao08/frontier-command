import { useEffect, useRef, useState } from 'react';
import type { AgentApiInput, AgentApiSettings, ModelInfo } from '../engine/agent-api';
import type { ReasoningEffort, ThinkingMode } from '../engine/types';
import { LcarsButton, LcarsField, LcarsPanel } from './components/Lcars';
import { AgentRuntime } from './AgentRuntime';
export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  'provider-default': 'PROVIDER DEFAULT / 供应商默认',
  none: 'LEGACY DEFAULT / 旧配置默认',
  minimal: 'MINIMAL / 最低',
  xhigh: 'XHIGH / 极高',
  max: 'MAX / 最大',
  low: 'LOW / 低',
  medium: 'MEDIUM / 中',
  high: 'HIGH / 高',
};
export function AgentApiSettingsPanel() {
  const [stored, setStored] = useState<AgentApiSettings | null>(null);
  const [draft, setDraft] = useState<AgentApiInput>({
    baseUrl: '',
    defaultModel: '',
    reasoningEffort: 'provider-default',
    thinking: 'provider-default',
  });
  const [key, setKey] = useState(''),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; reason: string } | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const testRequest = useRef<string | null>(null);
  useEffect(() => {
    void window.frontier.agentSettings().then((settings) => {
      setStored(settings);
      setDraft({
        baseUrl: settings.baseUrl,
        defaultModel: settings.defaultModel,
        reasoningEffort: settings.reasoningEffort,
        thinking: settings.thinking ?? 'provider-default',
        connectionTimeoutMs: settings.connectionTimeoutMs,
        idleTimeoutMs: settings.idleTimeoutMs,
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
          list="agent-model-directory"
          value={draft.defaultModel}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, defaultModel: e.target.value }))}
        />
      </LcarsField>
      <datalist id="agent-model-directory">
        {models.map((m) => (
          <option key={m.id} value={m.id} />
        ))}
      </datalist>
      <LcarsButton
        tone="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void window.frontier
            .fetchAgentModels(input())
            .then((r) => {
              setModels(r.models);
              setResult({ ok: r.ok, reason: r.reason });
            })
            .catch(() => setResult({ ok: false, reason: '模型目录服务不可用；可手动输入。' }))
            .finally(() => setBusy(false));
        }}
      >
        FETCH MODELS / 获取或刷新模型
      </LcarsButton>
      <LcarsField>
        THINKING / 默认思考
        <select
          aria-label="Agent 默认思考"
          value={draft.thinking ?? 'provider-default'}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, thinking: e.target.value as ThinkingMode }))}
        >
          <option value="provider-default">PROVIDER DEFAULT / 供应商默认</option>
          <option value="on">ON / 开启</option>
          <option value="off">OFF / 关闭</option>
        </select>
      </LcarsField>
      {models.find((m) => m.id === draft.defaultModel) && (
        <p className="muted">
          思考关闭：{models.find((m) => m.id === draft.defaultModel)!.capabilities.thinkingOff} ·
          Effort：{models.find((m) => m.id === draft.defaultModel)!.capabilities.reasoningEffort} ·
          能力依据：{models.find((m) => m.id === draft.defaultModel)!.capabilities.evidence}
        </p>
      )}
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
          {Object.entries(EFFORT_LABELS)
            .filter(([key]) => key !== 'none')
            .map(([effort, label]) => (
              <option key={effort} value={effort}>
                {label}
              </option>
            ))}
        </select>
      </LcarsField>
      <p className="muted">
        默认模式沿用供应商行为。显式 ON/OFF 与 Effort
        需要已确认的模型能力；不支持时会报错，不会静默改变设置。Key 通过系统加密独立保存。
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
