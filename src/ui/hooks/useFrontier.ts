import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, Snapshot } from '../../engine/types';
import type { Notice } from '../types';
export function useFrontier() {
  const [world, setWorld] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 7000 : 3500);
  }, []);
  const command = useCallback(
    async (c: Command, quiet = false) => {
      try {
        const result = await window.frontier.command(c);
        if (!result.ok || !quiet) notify(result.reason, !result.ok);
        return result;
      } catch {
        notify('无法连接模拟引擎，请保存并重启应用。', true);
        return { ok: false, reason: 'IPC 连接失败' };
      }
    },
    [notify],
  );
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    if (!window.frontier) return;
    window.frontier.getState().then((data) => {
      setWorld(data.state);
      if (data.saveBlocked) notify(data.saveMessage, true);
    });
    return window.frontier.onState(setWorld);
  }, [notify]);
  const save = async () => {
    const r = await window.frontier.save();
    notify(r.reason, !r.ok);
  };
  const reset = async () => {
    const r = await window.frontier.reset();
    notify(r.reason, !r.ok);
    return r;
  };
  return { world, notice, command, notify, save, reset, dismissNotice: () => setNotice(null) };
}
