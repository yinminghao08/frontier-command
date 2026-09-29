import { useEffect, useRef, useState } from 'react';
import type { Point, Snapshot } from './engine/types';
import { REGIONS } from './engine/definitions/locations';
import { SHIP_CLASSES } from './engine/definitions/ships';
import { RULES } from './engine/definitions/rules';
export type Selection =
  | { type: 'ship' | 'location' | 'contact' | 'order'; id: string }
  | { type: 'point'; x: number; y: number };
export function TacticalMap({
  world,
  selection,
  onSelect,
  focus,
}: {
  world: Snapshot;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  focus: { point: Point; serial: number } | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [layers, setLayers] = useState({
    Ships: true,
    Operations: true,
    Sensors: false,
    Threat: true,
    Intelligence: true,
  });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  const dragged = useRef(false);
  const [hover, setHover] = useState('');
  useEffect(() => {
    if (focus) setView({ k: 1.8, x: 800 - focus.point.x * 1.8, y: 400 - focus.point.y * 1.8 });
  }, [focus]);
  const local = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : new DOMPoint(x, y);
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      setView((v) => {
        const k = Math.max(0.7, Math.min(4, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const active = (id: string) => selection && 'id' in selection && selection.id === id;
  const choose = (s: Selection) => {
    if (!dragged.current) onSelect(s);
  };
  const interactive = (s: Selection, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      choose(s);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(s);
      }
    },
    onMouseEnter: () => setHover(label),
    onMouseLeave: () => setHover(''),
  });
  return (
    <div className="map-container">
      <div className="map-toolbar">
        <span>STRATEGIC SECTOR</span>
        <div className="layers">
          {Object.entries(layers).map(([name, enabled]) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => setLayers({ ...layers, [name]: !enabled })}
              />
              {name}
            </label>
          ))}
        </div>
      </div>
      <svg
        ref={svg}
        className="strategic-map"
        viewBox="0 0 1600 800"
        aria-label="战略星图"
        data-view={JSON.stringify(view)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = local(e.clientX, e.clientY);
          drag.current = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false };
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = local(e.clientX, e.clientY);
          if (Math.hypot(p.x - d.x, p.y - d.y) > 6) {
            d.moved = true;
            dragged.current = true;
            svg.current?.setPointerCapture(e.pointerId);
            setView((v) => ({ ...v, x: d.vx + p.x - d.x, y: d.vy + p.y - d.y }));
          }
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (svg.current?.hasPointerCapture(e.pointerId))
            svg.current.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClick={(e) => {
          if (dragged.current) return;
          const p = local(e.clientX, e.clientY),
            x = (p.x - view.x) / view.k,
            y = (p.y - view.y) / view.k;
          if (x >= 20 && x <= 1580 && y >= 20 && y <= 780)
            onSelect({ type: 'point', x: Math.round(x), y: Math.round(y) });
        }}
      >
        <defs>
          <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#243347" strokeWidth="1" />
          </pattern>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="1600" height="800" fill="#060b12" />
        <g transform={'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'}>
          {REGIONS.map((r) => (
            <g key={r.id}>
              <rect
                x={r.from}
                y="0"
                width={r.to - r.from}
                height="800"
                fill={r.color}
                opacity=".12"
              />
              <line
                x1={r.from}
                x2={r.from}
                y1="0"
                y2="800"
                stroke={r.color}
                strokeDasharray="10 10"
              />
              <text x={(r.from + r.to) / 2} y="35" textAnchor="middle" fill={r.color} fontSize="20">
                {r.label}
              </text>
            </g>
          ))}
          <rect width="1600" height="800" fill="url(#grid)" pointerEvents="none" />
          {Array.from({ length: 75 }, (_, i) => (
            <circle
              key={i}
              cx={(i * 137.31) % 1600}
              cy={(i * i * 19.77) % 800}
              r="1.4"
              fill="#8bacc5"
              opacity=".5"
            />
          ))}
          {layers.Intelligence &&
            world.explored.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r="65"
                fill="#b5a0ed"
                opacity=".06"
                stroke="#b5a0ed"
              />
            ))}
          {layers.Sensors && (
            <g
              fill="#68c8df"
              fillOpacity=".035"
              stroke="#68c8df"
              strokeOpacity=".3"
              strokeDasharray="5 9"
            >
              {world.locations
                .filter((l) => l.kind === 'base')
                .map((l) => (
                  <circle key={l.id} cx={l.x} cy={l.y} r={RULES.baseSensors} />
                ))}
              {world.ships.map((s) => (
                <circle
                  key={s.id}
                  cx={s.x}
                  cy={s.y}
                  r={SHIP_CLASSES[s.classId].sensors * (s.scanUntil > world.time ? 1.2 : 1)}
                />
              ))}
            </g>
          )}
          {layers.Threat &&
            world.contacts
              .filter((c) => c.hostile)
              .map((c) => (
                <circle
                  key={c.id}
                  cx={c.x}
                  cy={c.y}
                  r="155"
                  fill="#f47777"
                  opacity={c.live ? 0.08 : 0.035}
                  stroke="#ed7c79"
                  strokeDasharray="8 8"
                />
              ))}
          {layers.Operations &&
            world.ships
              .filter((s) => s.path.length)
              .map((s) => (
                <polyline
                  key={s.id}
                  points={[s, ...s.path].map((p) => p.x + ',' + p.y).join(' ')}
                  fill="none"
                  stroke={active(s.id) ? '#ffcb96' : '#a7a6d9'}
                  strokeWidth={active(s.id) ? 3 : 1.8}
                  strokeDasharray="8 7"
                  opacity=".75"
                />
              ))}
          {world.locations.map((l) => (
            <g
              key={l.id}
              transform={'translate(' + l.x + ' ' + l.y + ')'}
              {...interactive({ type: 'location', id: l.id }, l.name)}
            >
              <circle r="26" fill="transparent" />
              {active(l.id) && <circle r="28" fill="none" stroke="#fff0cb" strokeWidth="2" />}
              {l.kind === 'anomaly' ? (
                <g>
                  <ellipse rx="54" ry="28" fill="#a991e9" fillOpacity=".1" stroke="#b39bdc" />
                  <ellipse rx="35" ry="18" fill="none" stroke="#b39bdc" opacity=".5" />
                </g>
              ) : l.kind === 'base' ? (
                <g stroke="#f8bc88" fill="#141d2b">
                  <circle r="18" strokeWidth="4" />
                  <path d="M-30 0H30M0-30V30" />
                  <circle r="7" />
                </g>
              ) : l.kind === 'mine' ? (
                <path d="M0-13L13 0 0 13 -13 0Z" fill="#0b1520" stroke="#ebba80" strokeWidth="3" />
              ) : (
                <circle
                  r={l.kind === 'border' ? 6 : 11}
                  fill="#0a1821"
                  stroke={l.kind === 'planet' ? '#99d9b8' : '#8cafd5'}
                  strokeWidth="3"
                />
              )}
              {l.distress && <circle cx="19" cy="-20" r="7" fill="#fa827a" />}
              <text
                y={l.kind === 'anomaly' ? 44 : 36}
                textAnchor="middle"
                fill={active(l.id) ? '#fff0ca' : '#adc0d3'}
                fontSize={18 / Math.sqrt(view.k)}
              >
                {l.label}
              </text>
            </g>
          ))}
          {layers.Ships &&
            world.ships.map((s) => (
              <g
                key={s.id}
                style={{
                  transform: 'translate(' + s.x + 'px, ' + s.y + 'px)',
                  transition: world.paused ? 'none' : 'transform 100ms linear',
                }}
                {...interactive({ type: 'ship', id: s.id }, s.name)}
              >
                <circle r="24" fill="transparent" />
                {active(s.id) && <circle r="23" fill="none" stroke="#ffd6a0" strokeWidth="2" />}
                <path
                  transform={'rotate(' + ((s.heading * 180) / Math.PI + 90) + ')'}
                  d={
                    s.classId === 'galaxy'
                      ? 'M0-17L14 9 5 5 0 14 -5 5 -14 9Z'
                      : 'M0-13L9 10 0 6 -9 10Z'
                  }
                  fill={s.status === 'disabled' ? '#f47f79' : '#98c9e8'}
                  stroke="#e5f3ff"
                  strokeWidth="1.5"
                />
                <text y="-31" textAnchor="middle" fill="#e4edf8" fontSize={17 / Math.sqrt(view.k)}>
                  {s.status === 'docked' && !active(s.id) && hover !== s.name
                    ? s.name.split(' / ')[0].replace('USS ', '').slice(0, 3)
                    : s.name.split(' / ')[0].replace('USS ', '')}
                </text>
              </g>
            ))}
          {world.contacts
            .filter((c) => c.live || layers.Intelligence)
            .map((c) => (
              <g
                key={c.id}
                style={{
                  transform: 'translate(' + c.x + 'px, ' + c.y + 'px)',
                  transition: c.live && !world.paused ? 'transform 100ms linear' : 'none',
                }}
                opacity={c.live ? 1 : 0.5}
                {...interactive({ type: 'contact', id: c.id }, c.name ?? '未知接触 ' + c.id)}
              >
                <circle r="25" fill="transparent" />
                <path
                  d="M0-15L15 0 0 15 -15 0Z"
                  fill="#351e2b"
                  stroke={c.hostile ? '#f48379' : '#d3b780'}
                  strokeWidth="2"
                  strokeDasharray={c.live ? '' : '4 4'}
                />
                <text y="5" textAnchor="middle" fill="#ffd4ae" fontSize="17">
                  {c.level === 'CONTACT' ? '?' : '!'}
                </text>
                <text y="34" textAnchor="middle" fill="#dfaba3" fontSize={17 / Math.sqrt(view.k)}>
                  {c.live
                    ? (c.name ?? c.level)
                    : 'LAST KNOWN · ' + Math.floor(world.time - c.lastSeen) + 'm'}
                </text>
              </g>
            ))}
          {selection?.type === 'point' && (
            <g transform={'translate(' + selection.x + ' ' + selection.y + ')'} stroke="#d2bbf3">
              <circle r="18" fill="none" />
              <path d="M-25 0H25M0-25V25" />
            </g>
          )}
          {world.beams.map((b, i) => (
            <line
              key={i}
              x1={b.from.x}
              y1={b.from.y}
              x2={b.to.x}
              y2={b.to.y}
              stroke={b.enemy ? '#f38178' : '#fbd4a2'}
              strokeWidth={b.weapon.includes('Torpedo') ? 5 : 2}
              opacity=".85"
            />
          ))}
        </g>
      </svg>
      <div className="map-status">
        <span>{hover || '拖动平移 · 滚轮缩放 · 点击对象／空白区域'}</span>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })}>复位视角</button>
        <span>{view.k.toFixed(1)}×</span>
      </div>
    </div>
  );
}
