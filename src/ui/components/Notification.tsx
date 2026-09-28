import type { Notice } from '../types';

interface Props {
  notice: Notice;
  onDismiss: () => void;
}
export function Notification({ notice, onDismiss }: Props) {
  return (
    <div role="status" className={`toast ${notice.error ? 'error' : ''}`}>
      <span>{notice.error ? '!' : '✓'}</span>
      {notice.text}
      <button onClick={onDismiss} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}
