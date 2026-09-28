import { useEffect, useRef } from 'react';
import { WORLD_WIDTH, WORLD_HEIGHT, REGIONS } from './engine/definitions/locations';
import type { Point, Ship, Snapshot } from './engine/types';

export function TacticalMap({
  world,
  selected,
  onShip,
  onTarget,
  manual,
}: {
  world: Snapshot;
  selected: string;
  onShip(id: string): void;
  onTarget(id: string): void;
  manual: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(world);
  const previous = useRef(world);
  const received = useRef(performance.now());
  useEffect(() => {
    previous.current = latest.current;
    latest.current = world;
    received.current = performance.now();
  }, [world]);
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    let frame = 0;
    const draw = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (
        el.width !== Math.round(rect.width * dpr) ||
        el.height !== Math.round(rect.height * dpr)
      ) {
        el.width = Math.round(rect.width * dpr);
        el.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(el.width / WORLD_WIDTH, 0, 0, el.height / WORLD_HEIGHT, 0, 0);
      const scaleX = rect.width / WORLD_WIDTH,
        scaleY = rect.height / WORLD_HEIGHT;
      const label = (
        text: string,
        x: number,
        y: number,
        size: number,
        color: string,
        chinese = false,
        align: CanvasTextAlign = 'left',
      ) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1 / scaleX, 1 / scaleY);
        ctx.font = `${size}px ${chinese ? '"Microsoft YaHei", sans-serif' : 'Antonio'}`;
        ctx.textAlign = align;
        ctx.fillStyle = color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      };
      const w = latest.current;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.strokeStyle = '#142028';
      ctx.lineWidth = 1;
      for (let x = 0; x <= WORLD_WIDTH; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y <= WORLD_HEIGHT; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_WIDTH, y);
        ctx.stroke();
      }
      for (let i = 0; i < 130; i++) {
        const x = (i * 137.31) % WORLD_WIDTH,
          y = (i * i * 19.77) % WORLD_HEIGHT;
        ctx.fillStyle = i % 5 === 0 ? '#67848a' : '#293841';
        ctx.fillRect(x, y, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
      }
      for (const region of REGIONS) {
        ctx.fillStyle = region.color + '18';
        ctx.fillRect(region.from, 0, region.to - region.from, WORLD_HEIGHT);
        if (region.from > 0) {
          ctx.strokeStyle = region.color + '99';
          ctx.setLineDash([12, 8]);
          ctx.beginPath();
          ctx.moveTo(region.from, 0);
          ctx.lineTo(region.from, WORLD_HEIGHT);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const labelX = region.id === 'federation' ? 32 : (region.from + region.to) / 2;
        const align = region.id === 'federation' ? 'left' : 'center';
        label(region.label, labelX, 38, 10, region.color, false, align);
        label(region.name, labelX, 67, 9, '#a1abbc', true, align);
      }
      ctx.font = '12px Antonio';
      for (let i = 1; i < WORLD_WIDTH / 100; i++)
        ctx.fillText(String(i).padStart(2, '0'), i * 100 + 5, 788);
      for (const loc of w.locations) {
        const selectedMission = w.missions.find(
          (m) => m.shipId === selected && !m.settled && m.locationId === loc.id,
        );
        ctx.strokeStyle = selectedMission ? '#fcc19f' : '#596879';
        ctx.fillStyle = '#04080b';
        ctx.lineWidth = 2;
        if (loc.kind === 'anomaly') {
          ctx.strokeStyle = '#baa4e52f';
          for (let r = 25; r <= 75; r += 17) {
            ctx.beginPath();
            ctx.ellipse(loc.x, loc.y, r, r * 0.6, -0.4, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.strokeStyle = '#baa4e5';
          ctx.beginPath();
          ctx.arc(loc.x, loc.y, 7, 0, Math.PI * 2);
          ctx.stroke();
        } else if (loc.kind === 'mine') {
          ctx.strokeStyle = '#edb378';
          ctx.beginPath();
          ctx.moveTo(loc.x, loc.y - 10);
          ctx.lineTo(loc.x + 10, loc.y);
          ctx.lineTo(loc.x, loc.y + 10);
          ctx.lineTo(loc.x - 10, loc.y);
          ctx.closePath();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(loc.x - 4, loc.y);
          ctx.lineTo(loc.x + 4, loc.y);
          ctx.stroke();
        } else if (loc.kind === 'planet') {
          ctx.strokeStyle = '#83ba99';
          ctx.beginPath();
          ctx.arc(loc.x, loc.y, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(loc.x, loc.y, 11, 4, -0.4, 0, Math.PI * 2);
          ctx.stroke();
        } else if (loc.kind === 'base') {
          ctx.strokeStyle = '#fcc19f';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(loc.x, loc.y, 19, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(loc.x, loc.y, 9, 0, Math.PI * 2);
          ctx.stroke();
          for (let a = 0; a < 6; a++) {
            const angle = (a * Math.PI) / 3;
            ctx.beginPath();
            ctx.moveTo(loc.x + Math.cos(angle) * 16, loc.y + Math.sin(angle) * 16);
            ctx.lineTo(loc.x + Math.cos(angle) * 31, loc.y + Math.sin(angle) * 31);
            ctx.stroke();
          }
        } else if (loc.kind === 'border') {
          ctx.strokeStyle = '#c47d69';
          ctx.strokeRect(loc.x - 8, loc.y - 8, 16, 16);
          ctx.beginPath();
          ctx.moveTo(loc.x - 15, loc.y);
          ctx.lineTo(loc.x + 15, loc.y);
          ctx.moveTo(loc.x, loc.y - 15);
          ctx.lineTo(loc.x, loc.y + 15);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(loc.x, loc.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        const right = loc.x > 700 || loc.kind === 'planet',
          labelX = loc.x + (right ? -22 : 25),
          color = loc.kind === 'base' ? '#fcc19f' : '#a1abbc';
        label(
          loc.label,
          labelX,
          loc.y + (loc.kind === 'mine' ? 35 : -32),
          11,
          color,
          false,
          right ? 'right' : 'left',
        );
        label(
          loc.name,
          labelX,
          loc.y + (loc.kind === 'mine' ? 80 : 7),
          9,
          color,
          true,
          right ? 'right' : 'left',
        );
      }
      for (const s of w.ships) {
        const active = s.id === selected;
        const color = s.id === 'verity' ? '#baa4e5' : s.id === 'meridian' ? '#edb378' : '#8899ff';
        if (s.trail.length > 1) {
          ctx.strokeStyle = color + '33';
          ctx.lineWidth = 1;
          ctx.beginPath();
          s.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.stroke();
        }
        if (active && s.path.length) {
          ctx.strokeStyle = color + '66';
          ctx.setLineDash([4, 7]);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          for (const p of s.path) ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const old = previous.current.ships.find((p) => p.id === s.id) ?? s;
        const t = w.paused ? 1 : Math.min(1, (performance.now() - received.current) / 100);
        const x = old.x + (s.x - old.x) * t,
          y = old.y + (s.y - old.y) * t;
        if (active) {
          ctx.strokeStyle = color + '22';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, manual ? 145 : 220, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          for (const sign of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(x + sign * 23, y - 13);
            ctx.lineTo(x + sign * 23, y - 23);
            ctx.lineTo(x + sign * 13, y - 23);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + sign * 23, y + 13);
            ctx.lineTo(x + sign * 23, y + 23);
            ctx.lineTo(x + sign * 13, y + 23);
            ctx.stroke();
          }
        }
        drawShip(ctx, { ...s, x, y }, color, scaleX, scaleY);
        if (s.status !== 'docked') label(s.name.replace('USS ', ''), x + 28, y + 40, 10, color);
      }
      for (const t of w.contacts) {
        const targeted = w.ships.find((s) => s.id === selected)?.targetId === t.id;
        ctx.strokeStyle = t.retreating ? '#677c72' : t.hostile ? '#ff655d' : '#e8a66e';
        ctx.lineWidth = targeted ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y - 12);
        ctx.lineTo(t.x + 14, t.y);
        ctx.lineTo(t.x, t.y + 12);
        ctx.lineTo(t.x - 14, t.y);
        ctx.closePath();
        ctx.stroke();
        if (targeted) ctx.strokeRect(t.x - 22, t.y - 22, 44, 44);
        label(
          t.identified ? t.faction.toUpperCase() : 'UNKNOWN CONTACT',
          t.x - 22,
          t.y - 27,
          10,
          String(ctx.strokeStyle),
          false,
          'right',
        );
      }
      for (const beam of w.beams) {
        ctx.strokeStyle = beam.enemy ? '#ff554c' : '#ffbc7a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(beam.from.x, beam.from.y);
        ctx.lineTo(beam.to.x, beam.to.y);
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [selected, manual]);
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = {
      x: ((e.clientX - rect.left) / rect.width) * WORLD_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * WORLD_HEIGHT,
    };
    const nearest = <T extends Point>(items: T[]) =>
      [...items]
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
        .find((a) => Math.hypot(a.x - p.x, a.y - p.y) < 36);
    const target = nearest(world.contacts);
    if (target) {
      onTarget(target.id);
      return;
    }
    const ship = nearest(world.ships);
    if (ship && !manual) onShip(ship.id);
  };
  return (
    <>
      <canvas
        ref={canvas}
        onClick={click}
        className="tactical-canvas"
        aria-label="曙光边区战略星图：Federation Space、Neutral Zone、Romulan Space。可点击己方舰船或接触；同样操作可通过右侧按钮完成。"
      />
      <div className="map-legend" aria-label="星图图例">
        <span>◎ 曙光基地</span>
        <span>○ 殖民地 / 前哨</span>
        <span>◇ 矿场</span>
        <span>⊕ M级行星</span>
        <span>≈ 异常区</span>
        <span>⊞ 边境地点</span>
        <span>虚线以东：中立区 / 罗慕兰空间（暂未开放）</span>
      </div>
    </>
  );
}
function drawShip(
  c: CanvasRenderingContext2D,
  s: Ship,
  color: string,
  scaleX: number,
  scaleY: number,
) {
  c.save();
  c.translate(s.x, s.y);
  c.scale(0.58 / scaleX, 0.58 / scaleY);
  c.rotate(s.heading + Math.PI / 2);
  c.strokeStyle = color;
  c.fillStyle = '#0b1118';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(0, -7, s.id === 'meridian' ? 7 : 10, 8, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(-3, 0);
  c.lineTo(-4, 13);
  c.lineTo(4, 13);
  c.lineTo(3, 0);
  c.stroke();
  c.beginPath();
  c.moveTo(-4, 6);
  c.lineTo(-13, 10);
  c.moveTo(4, 6);
  c.lineTo(13, 10);
  c.stroke();
  c.fillStyle = color;
  c.fillRect(-15, 0, 3, 17);
  c.fillRect(12, 0, 3, 17);
  c.restore();
}
