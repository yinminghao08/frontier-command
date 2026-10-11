import { isDeepSeek, thinkingConflict, deepSeekEffort } from '../engine/deepseek';
import { LcarsButton } from './components/Lcars';
export function ReasoningNotice({
  baseUrl,
  thinking,
  effort,
  resetEffort,
}: {
  baseUrl: string;
  thinking: string;
  effort: string;
  resetEffort: () => void;
}) {
  return (
    <>
      {isDeepSeek(baseUrl) && (
        <p className="muted">
          DEEPSEEK / 供应商默认可能开启 HIGH 思考。显式强度实际为 {deepSeekEffort(effort)}；
          默认档位不发送 reasoning_effort。ON/OFF 分别发送 thinking enabled/disabled。
          未确认的模型或不支持的档位会明确报错；可刷新官方模型目录。
        </p>
      )}
      {thinkingConflict(thinking, effort) && (
        <p role="alert" className="api-test-error">
          Thinking OFF 与显式 Effort 冲突，无法保存或调用。
          <LcarsButton tone="secondary" onClick={resetEffort}>
            保留 OFF，将 Effort 改为供应商默认
          </LcarsButton>
        </p>
      )}
    </>
  );
}
