import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLcars } from './ui/lcars/LcarsProvider';
import { LcarsButton } from './ui/components/Lcars';
import type { Point, Snapshot } from './engine/types';
import { SECTOR_SIZE, regionAt } from './engine/definitions/locations';
import { sectorCenter } from './engine/world-generation';
import { capabilities } from './engine/capabilities';
import {
  boundsOf,
  fitCamera,
  clampCamera,
  zoomCamera,
  resizeCamera,
  focusCamera,
  project,
  unproject,
  placeLabels,
  type Camera,
  type MapLabel,
} from './ui/map/camera';
export type Selection =
  | {
      type: 'ship' | 'location' | 'contact' | 'system' | 'body' | 'project' | 'wreck' | 'loss';
      id: string;
    }
  | { type: 'point'; x: number; y: number }
  | { type: 'sector'; q: number; r: number };
export function StrategicMap({
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
  const { preferences, audio } = useLcars(),
    motion = useRef(preferences.animations);
  motion.current = preferences.animations;
  const viewport = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    initialized = useRef(false);
  const known = () => [...world.locations, ...world.systems];
  const [camera, setCamera] = useState(() => fitCamera(1, 1, boundsOf(known()))),
    current = useRef(camera),
    target = useRef(camera),
    frame = useRef(0);
  const [layers, setLayers] = useState({ Routes: true, Sensors: false, Intelligence: true });
  const drag = useRef<{ point: Point; camera: Camera } | null>(null),
    moved = useRef(false);
  const commit = (c: Camera) => {
    current.current = c;
    target.current = c;
    setCamera(c);
  };
  const local = (x: number, y: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };
  const animate = (next: Camera) => {
    cancelAnimationFrame(frame.current);
    target.current = next;
    if (motion.current !== 'on') {
      commit(next);
      return;
    }
    const start = current.current,
      started = performance.now();
    const tick = () => {
      const t = target.current,
        progress = Math.min(1, (performance.now() - started) / 180),
        ease = 1 - (1 - progress) ** 3;
      if (progress === 1 || motion.current !== 'on') {
        commit(t);
        return;
      }
      const n = clampCamera({
        ...t,
        k: start.k + (t.k - start.k) * ease,
        x: start.x + (t.x - start.x) * ease,
        y: start.y + (t.y - start.y) * ease,
      });
      current.current = n;
      setCamera(n);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useLayoutEffect(() => {
    const el = viewport.current!;
    const update = () => {
      cancelAnimationFrame(frame.current);
      const next = initialized.current
        ? resizeCamera(current.current, el.clientWidth, el.clientHeight)
        : fitCamera(el.clientWidth, el.clientHeight, boundsOf(known()));
      initialized.current = true;
      commit(next);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    if (focus) animate(focusCamera(current.current, focus.point));
  }, [focus]);
  useEffect(() => {
    const el = svg.current!,
      wheel = (e: WheelEvent) => {
        e.preventDefault();
        animate(
          zoomCamera(
            target.current,
            target.current.k * Math.exp(-e.deltaY * 0.0015),
            local(e.clientX, e.clientY),
          ),
        );
      };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const active = (id: string) => selection && 'id' in selection && selection.id === id,
    level = camera.k < 0.65 ? 'SECTOR' : camera.k < 1.5 ? 'SYSTEM' : 'LOCAL',
    pos = (p: Point) => project(p, camera);
  const visible = (p: Point) => {
    const n = pos(p);
    return n.x >= -35 && n.y >= -35 && n.x <= camera.width + 35 && n.y <= camera.height + 35;
  };
  const interactive = (s: Selection, name: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': name,
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      moved.current = false;
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!moved.current) {
        audio.play('navigation');
        onSelect(s);
      }
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        audio.play('navigation');
        onSelect(s);
      }
    },
  });
  const markers: {
    id: string;
    name: string;
    p: Point;
    selection: Selection;
    kind: string;
    color: string;
  }[] = [
    ...world.systems
      .filter(visible)
      .map((s) => ({
        id: s.id,
        name: s.name,
        p: s,
        selection: { type: 'system', id: s.id } as Selection,
        kind: 'system',
        color: 'var(--african-violet)',
      })),
    ...world.bodies
      .filter((b) => visible(b) && (level === 'LOCAL' || active(b.id) || active(b.systemId)))
      .map((b) => ({
        id: b.id,
        name: b.name,
        p: b,
        selection: { type: 'body', id: b.id } as Selection,
        kind: b.kind,
        color: b.kind === 'resource' ? 'var(--almond-creme)' : 'var(--african-violet)',
      })),
    ...world.locations
      .filter(visible)
      .map((l) => ({
        id: l.id,
        name: l.name,
        p: l,
        selection: { type: 'location', id: l.id } as Selection,
        kind: l.kind,
        color: l.owner === 'starfleet' ? 'var(--bluey)' : 'var(--red)',
      })),
    ...world.projects
      .filter((p) => !p.complete && visible(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        p,
        selection: { type: 'project', id: p.id } as Selection,
        kind: 'project',
        color: 'var(--orange)',
      })),
    ...world.wrecks
      .filter(visible)
      .map((p) => ({
        id: p.id,
        name: p.name,
        p,
        selection: { type: 'wreck', id: p.id } as Selection,
        kind: 'wreck',
        color: 'var(--almond-creme)',
      })),
    ...world.ships
      .filter(visible)
      .map((s) => ({
        id: s.id,
        name: s.name,
        p: s,
        selection: { type: 'ship', id: s.id } as Selection,
        kind: 'ship',
        color: 'var(--bluey)',
      })),
    ...world.contacts
      .filter((c) => visible(c) && (c.live || layers.Intelligence))
      .map((c) => ({
        id: c.id,
        name: (c.live ? '' : 'LKP ') + (c.name ?? c.level),
        p: c,
        selection: { type: 'contact', id: c.id } as Selection,
        kind: 'contact',
        color: c.hostile ? 'var(--red)' : 'var(--african-violet)',
      })),
  ];
  const markerScale = Math.min(1.5, Math.max(1, camera.width / 1500));
  const labels: MapLabel[] = markers.map((m) => ({
    ...pos(m.p),
    id: m.id,
    text: m.name.split(' / ')[0],
    priority: active(m.id)
      ? 100
      : m.kind === 'ship'
        ? 80
        : m.kind === 'base'
          ? 90
          : m.kind === 'system'
            ? 35
            : 25,
    color: m.color,
  }));
  const placed = placeLabels(labels, camera.width, camera.height, markerScale);
  const left = unproject({ x: 0, y: 0 }, camera),
    right = unproject({ x: camera.width, y: camera.height }, camera),
    cells = [];
  const minQ = Math.max(Math.floor((left.x + 200) / 400), Math.floor(camera.x / 400) - 12),
    maxQ = Math.min(Math.floor((right.x + 200) / 400), Math.floor(camera.x / 400) + 12),
    minR = Math.max(Math.floor((left.y + 200) / 400), Math.floor(camera.y / 400) - 12),
    maxR = Math.min(Math.floor((right.y + 200) / 400), Math.floor(camera.y / 400) + 12);
  for (let q = minQ; q <= maxQ; q++)
    for (let r = minR; r <= maxR; r++)
      cells.push({ q, r, known: world.sectors.some((s) => s.q === q && s.r === r) });
  return (
    <section
      className="map-container"
      aria-label="Strategic Map workspace"
      style={
        {
          '--map-label-size': 14 * markerScale + 'px',
          '--map-region-size': 17 * markerScale + 'px',
        } as CSSProperties
      }
    >
      <div className="map-toolbar">
        <span>
          STRATEGIC MAP <b>{level}</b>
        </span>
        <div className="layers">
          {Object.entries(layers).map(([name, on]) => (
            <LcarsButton
              key={name}
              sound="navigation"
              aria-pressed={on}
              onClick={() => setLayers({ ...layers, [name]: !on })}
            >
              {name}
            </LcarsButton>
          ))}
        </div>
      </div>
      <div className="map-viewport" ref={viewport}>
        <svg
          ref={svg}
          className="strategic-map"
          aria-label="战略星图"
          viewBox={'0 0 ' + camera.width + ' ' + camera.height}
          data-view={JSON.stringify(camera)}
          data-level={level}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            cancelAnimationFrame(frame.current);
            moved.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { point: local(e.clientX, e.clientY), camera: current.current };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = local(e.clientX, e.clientY);
            if (Math.hypot(p.x - d.point.x, p.y - d.point.y) > 5) {
              moved.current = true;
              commit({
                ...d.camera,
                x: d.camera.x - (p.x - d.point.x) / d.camera.k,
                y: d.camera.y - (p.y - d.point.y) / d.camera.k,
              });
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
            if (moved.current) return;
            const p = unproject(local(e.clientX, e.clientY), camera);
            onSelect({ type: 'point', x: Math.round(p.x), y: Math.round(p.y) });
          }}
        >
          <rect width={camera.width} height={camera.height} fill="#000" />
          {cells.map((c) => {
            const center = sectorCenter(c),
              p = pos({ x: center.x - 200, y: center.y - 200 }),
              size = SECTOR_SIZE * camera.k,
              label = c.known ? regionAt(center.x, center.y).toUpperCase() : 'UNKNOWN SPACE';
            return (
              <g
                key={c.q + ':' + c.r}
                {...interactive(
                  { type: 'sector', q: c.q, r: c.r },
                  (c.known ? 'Sector ' : 'UNKNOWN ') + c.q + '/' + c.r,
                )}
              >
                <rect
                  x={p.x}
                  y={p.y}
                  width={size}
                  height={size}
                  fill={c.known ? 'var(--bluey)' : 'var(--african-violet)'}
                  fillOpacity={c.known ? 0.045 : 0.015}
                  stroke="var(--african-violet)"
                  strokeOpacity=".15"
                />
                {size > 110 && (
                  <text
                    x={p.x + size / 2}
                    y={p.y + 30}
                    textAnchor="middle"
                    fill="var(--african-violet)"
                    opacity=".6"
                    className="region-label"
                  >
                    {label} {c.q}/{c.r}
                  </text>
                )}
              </g>
            );
          })}
          {layers.Routes &&
            world.ships
              .filter((s) => s.path.length)
              .map((s) => (
                <polyline
                  key={s.id}
                  points={[s, ...s.path]
                    .map((p) => {
                      const n = pos(p);
                      return n.x + ',' + n.y;
                    })
                    .join(' ')}
                  fill="none"
                  stroke={active(s.id) ? 'var(--almond-creme)' : 'var(--african-violet)'}
                  strokeWidth="2"
                  strokeDasharray="7 5"
                  pointerEvents="none"
                />
              ))}
          {(layers.Sensors || level === 'LOCAL') &&
            world.ships.filter(visible).map((s) => {
              const p = pos(s);
              return (
                <circle
                  key={s.id}
                  cx={p.x}
                  cy={p.y}
                  r={capabilities(s).sensors * camera.k}
                  fill="var(--bluey)"
                  fillOpacity=".025"
                  stroke="var(--bluey)"
                  strokeOpacity=".2"
                  strokeDasharray="3 6"
                  pointerEvents="none"
                />
              );
            })}
          {markers.map((m) => {
            const p = pos(m.p);
            return (
              <g
                key={m.id}
                transform={'translate(' + p.x + ' ' + p.y + ') scale(' + markerScale + ')'}
                {...interactive(m.selection, m.name)}
              >
                <circle r="17" fill="transparent" />
                {active(m.id) && (
                  <circle
                    className="selection-reticle"
                    r="20"
                    fill="none"
                    stroke="var(--almond-creme)"
                    strokeWidth="2"
                  />
                )}
                {m.kind === 'ship' ? (
                  <path d="M0-9L7 7 0 4 -7 7Z" fill={m.color} stroke="var(--almond-creme)" />
                ) : m.kind === 'base' ? (
                  <g stroke={m.color} fill="#000" strokeWidth="3">
                    <circle r="12" />
                    <path d="M-18 0H18M0-18V18" />
                    <circle r="4" />
                  </g>
                ) : ['resource', 'mine', 'contact', 'wreck', 'project'].includes(m.kind) ? (
                  <path
                    d="M0-10L10 0 0 10 -10 0Z"
                    fill="#000"
                    stroke={m.color}
                    strokeWidth="2"
                    strokeDasharray={m.kind === 'project' ? '3 3' : ''}
                  />
                ) : m.kind === 'anomaly' ? (
                  <ellipse rx="19" ry="9" fill={m.color} fillOpacity=".15" stroke={m.color} />
                ) : (
                  <circle
                    r={m.kind === 'system' ? 10 : 6}
                    fill="#000"
                    stroke={m.color}
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}
          {world.beams.map((b, i) => {
            const a = pos(b.from),
              z = pos(b.to);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={z.x}
                y2={z.y}
                stroke={b.enemy ? 'var(--red)' : 'var(--almond-creme)'}
                strokeWidth={b.weapon.includes('Torpedo') ? 4 : 2}
                pointerEvents="none"
              />
            );
          })}
          {placed.map((l) => (
            <text
              key={l.id}
              x={l.x}
              y={l.y}
              textAnchor="middle"
              fill={l.color}
              className="map-label"
              pointerEvents="none"
            >
              {l.text}
            </text>
          ))}
        </svg>
      </div>
      <div className="map-status">
        <span>DAWN FRONTIER · DRAG / SEMANTIC ZOOM / SELECT</span>
        <div className="camera-controls">
          <LcarsButton
            sound="navigation"
            aria-label="缩小地图"
            onClick={() =>
              animate(
                zoomCamera(current.current, current.current.k / 1.4, {
                  x: camera.width / 2,
                  y: camera.height / 2,
                }),
              )
            }
          >
            −
          </LcarsButton>
          <LcarsButton
            sound="navigation"
            aria-label="放大地图"
            onClick={() =>
              animate(
                zoomCamera(current.current, current.current.k * 1.4, {
                  x: camera.width / 2,
                  y: camera.height / 2,
                }),
              )
            }
          >
            +
          </LcarsButton>
          <LcarsButton
            sound="navigation"
            onClick={() => commit(fitCamera(camera.width, camera.height, boundsOf(known())))}
          >
            FIT
          </LcarsButton>
          <b>{camera.k.toFixed(2)}×</b>
        </div>
      </div>
    </section>
  );
}
