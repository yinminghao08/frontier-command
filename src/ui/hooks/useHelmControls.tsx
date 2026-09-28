import { useEffect, useRef } from 'react';
import type { Snapshot } from '../../engine/types';
import type { CommandSender } from '../types';
export function useHelmControls(world: Snapshot | null, command: CommandSender) {
  const worldRef = useRef(world);
  worldRef.current = world;
  const held = useRef(new Set<string>());
  const lastHelm = useRef('');
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !worldRef.current?.manualShipId ||
        /INPUT|SELECT|TEXTAREA/.test((event.target as HTMLElement).tagName)
      )
        return;
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'].includes(event.code)) {
        event.preventDefault();
        held.current.add(event.code);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      held.current.delete(event.code);
    };
    const clear = () => {
      held.current.clear();
      lastHelm.current = '';
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clear);
    const timer = setInterval(() => {
      const w = worldRef.current,
        id = w?.manualShipId;
      if (!id || w?.paused) {
        held.current.clear();
        lastHelm.current = '';
        return;
      }
      const turn = Number(held.current.has('KeyD')) - Number(held.current.has('KeyA'));
      const throttle = Number(held.current.has('KeyW')) - Number(held.current.has('KeyS'));
      const signature = `${id}:${turn}:${throttle}`;
      if (signature !== lastHelm.current) {
        void command({ type: 'helm', shipId: id, turn, throttle }, true);
        lastHelm.current = signature;
      }
      if (held.current.has('Space') && (w.ships.find((s) => s.id === id)?.cooldown ?? 0) <= 0) {
        held.current.delete('Space');
        void command({ type: 'fire', shipId: id }, true);
      }
    }, 80);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
    };
  }, [command]);
  const helmButton = (key: string, label: string) => (
    <button
      className="helm-key"
      disabled={!world || world.paused}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        held.current.add(key);
      }}
      onPointerUp={() => held.current.delete(key)}
      onPointerCancel={() => held.current.delete(key)}
    >
      {label}
    </button>
  );
  return helmButton;
}
