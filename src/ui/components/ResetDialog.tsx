import { Bar } from '../components/primitives';

interface Props {
  onCancel: () => void;
  onReset: () => Promise<void>;
}
export function ResetDialog({ onCancel, onReset }: Props) {
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="reset-title" className="lcars-modal">
        <Bar code="COMPUTER">重置世界</Bar>
        <h2 id="reset-title">归档当前世界并重新开始？</h2>
        <p>当前存档会保留为带时间戳的归档文件。新世界使用相同初始种子，恢复三艘舰船与六项任务。</p>
        <div className="button-row">
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={onReset}>
            归档并重置
          </button>
        </div>
      </div>
    </div>
  );
}
