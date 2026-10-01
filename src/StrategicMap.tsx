import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLcars } from './ui/lcars/LcarsProvider';
import { LcarsButton } from './ui/components/Lcars';
import type { Point, Snapshot } from './engine/types';
import {
  REGIONS,
  TRANSPORT_LINKS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from './engine/definitions/locations';
import { SHIP_CLASSES } from './engine/definitions/ships';
import { RULES } from './engine/definitions/rules';
import {
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
  | { type: 'ship' | 'location' | 'contact' | 'order' | 'loss'; id: string }
  | { type: 'point'; x: number; y: number };
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
  const { preferences, audio } = useLcars();
  const motion = useRef(preferences.animations);
  motion.current = preferences.animations;
  const viewport = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [camera, setCamera] = useState(() => fitCamera(1, 1)),
    current = useRef(camera),
    target = useRef(camera),
    frame = useRef(0);
  const [layers, setLayers] = useState({ Routes: true, Sensors: false, Intelligence: true });
  const drag = useRef<{ point: Point; camera: Camera; moved: boolean } | null>(null),
    moved = useRef(false);
  const commit = (c: Camera) => {
    current.current = c;
    target.current = c;
    setCamera(c);
  };
  const local = (x: number, y: number): Point => {
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
        ease = 1 - Math.pow(1 - progress, 3);
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
      commit(resizeCamera(current.current, el.clientWidth, el.clientHeight));
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
    const el = svg.current!;
    const wheel = (e: WheelEvent) => {
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
  const active = (id: string) => selection && 'id' in selection && selection.id === id;
  const level = camera.k < 1.65 ? 'SECTOR' : camera.k < 3 ? 'REGIONAL' : 'LOCAL';
  const pos = (p: Point) => project(p, camera);
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
  const locations = world.locations.filter(
    (l) =>
      level !== 'SECTOR' ||
      ['base', 'colony', 'outpost', 'anomaly'].includes(l.kind) ||
      active(l.id),
  );
  const labels: MapLabel[] = [
    ...locations.map((l) => ({
      ...pos(l),
      id: l.id,
      text: l.label,
      priority: active(l.id) ? 100 : l.kind === 'base' ? 80 : l.distress ? 75 : 30,
      color: l.kind === 'base' ? 'var(--almond-creme)' : 'var(--bluey)',
    })),
    ...world.ships
      .filter((s) => level !== 'SECTOR' || active(s.id))
      .map((s) => ({
        ...pos(s),
        id: s.id,
        text: s.name.split(' / ')[0],
        priority: active(s.id) ? 100 : 50,
        color: 'var(--bluey)',
      })),
    ...world.contacts
      .filter((c) => c.live || layers.Intelligence)
      .map((c) => ({
        ...pos(c),
        id: c.id,
        text: c.live ? (c.name ?? c.level) : 'LKP ' + Math.floor(world.time - c.lastSeen) + 'm',
        priority: active(c.id) ? 100 : 70,
        color: c.hostile ? 'var(--red)' : 'var(--african-violet)',
      })),
  ];
  const markerScale = Math.min(1.5, Math.max(1, camera.width / 1500));
  const placed = placeLabels(labels, camera.width, camera.height, markerScale);
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
              sound="navigation"
              key={name}
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
            drag.current = {
              point: local(e.clientX, e.clientY),
              camera: current.current,
              moved: false,
            };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = local(e.clientX, e.clientY);
            if (Math.hypot(p.x - d.point.x, p.y - d.point.y) > 5) {
              moved.current = true;
              d.moved = true;
              svg.current?.setPointerCapture(e.pointerId);
              commit(
                clampCamera({
                  ...d.camera,
                  x: d.camera.x + p.x - d.point.x,
                  y: d.camera.y + p.y - d.point.y,
                }),
              );
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
            audio.play('navigation');
            const p = unproject(local(e.clientX, e.clientY), camera);
            onSelect({
              type: 'point',
              x: Math.round(Math.max(20, Math.min(1580, p.x))),
              y: Math.round(Math.max(20, Math.min(780, p.y))),
            });
          }}
        >
          <rect width={camera.width} height={camera.height} fill="#000" />
          <g
            transform={
              'translate(' +
              camera.x +
              ' ' +
              camera.y +
              ') scale(' +
              (camera.width / WORLD_WIDTH) * camera.k +
              ' ' +
              (camera.height / WORLD_HEIGHT) * camera.k +
              ')'
            }
          >
            {REGIONS.map((r) => (
              <polygon
                key={r.id}
                points={r.points.map((p) => p.x + ',' + p.y).join(' ')}
                fill={
                  r.id === 'romulan'
                    ? 'var(--red)'
                    : r.id === 'neutral'
                      ? 'var(--african-violet)'
                      : 'var(--bluey)'
                }
                fillOpacity=".065"
                stroke={
                  r.id === 'romulan'
                    ? 'var(--red)'
                    : r.id === 'neutral'
                      ? 'var(--african-violet)'
                      : 'var(--bluey)'
                }
                strokeOpacity=".5"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {Array.from({ length: 100 }, (_, i) => (
              <circle
                key={i}
                cx={(i * 157.3) % 1600}
                cy={(i * i * 37.1) % 800}
                r="1"
                fill="var(--bluey)"
                opacity=".45"
              />
            ))}
            {TRANSPORT_LINKS.map(([a, b]) => {
              const x = world.locations.find((l) => l.id === a)!,
                y = world.locations.find((l) => l.id === b)!;
              return (
                <line
                  key={a + b}
                  x1={x.x}
                  y1={x.y}
                  x2={y.x}
                  y2={y.y}
                  stroke="var(--bluey)"
                  strokeOpacity=".16"
                  strokeDasharray="3 7"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {layers.Routes &&
              world.ships
                .filter((s) => s.path.length)
                .map((s) => (
                  <polyline
                    key={s.id}
                    points={[s, ...s.path].map((p) => p.x + ',' + p.y).join(' ')}
                    fill="none"
                    stroke={active(s.id) ? 'var(--almond-creme)' : 'var(--african-violet)'}
                    strokeWidth="2"
                    strokeDasharray="7 5"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            {(layers.Sensors || level === 'LOCAL') && (
              <g
                fill="var(--bluey)"
                fillOpacity=".025"
                stroke="var(--bluey)"
                strokeOpacity=".25"
                strokeDasharray="3 6"
              >
                {world.ships.map((s) => (
                  <circle
                    key={s.id}
                    cx={s.x}
                    cy={s.y}
                    r={SHIP_CLASSES[s.classId].sensors * (s.scanUntil > world.time ? 1.2 : 1)}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {world.locations
                  .filter((l) => l.kind === 'base' && l.hull > 0)
                  .map((l) => (
                    <circle
                      key={l.id}
                      cx={l.x}
                      cy={l.y}
                      r={RULES.baseSensors}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
              </g>
            )}
            {world.explored.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r="65"
                fill="var(--african-violet)"
                fillOpacity=".04"
                stroke="var(--african-violet)"
                strokeOpacity=".2"
              />
            ))}
          </g>
          {REGIONS.map((r) => {
            const p = pos(r.labelPoint);
            return (
              <text
                key={r.id}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                className="region-label"
                fill={
                  r.id === 'romulan'
                    ? 'var(--red)'
                    : r.id === 'neutral'
                      ? 'var(--african-violet)'
                      : 'var(--bluey)'
                }
              >
                {r.label}
              </text>
            );
          })}
          {locations.map((l) => {
            const p = pos(l);
            return (
              <g
                key={l.id}
                transform={'translate(' + p.x + ' ' + p.y + ') scale(' + markerScale + ')'}
                {...interactive({ type: 'location', id: l.id }, l.name)}
              >
                <circle r="19" fill="transparent" />
                {active(l.id) && (
                  <circle
                    className="selection-reticle"
                    r="22"
                    fill="none"
                    stroke="var(--almond-creme)"
                    strokeWidth="2"
                  />
                )}
                {l.kind === 'base' ? (
                  <g stroke="var(--almond-creme)" fill="#000" strokeWidth="3">
                    <circle r="12" />
                    <path d="M-18 0H18M0-18V18" />
                    <circle r="4" />
                  </g>
                ) : l.kind === 'anomaly' ? (
                  <g fill="var(--african-violet)" fillOpacity=".14" stroke="var(--african-violet)">
                    <ellipse rx="24" ry="12" />
                    <ellipse rx="14" ry="7" />
                  </g>
                ) : l.kind === 'mine' ? (
                  <path
                    d="M0-9L9 0 0 9 -9 0Z"
                    fill="#000"
                    stroke="var(--almond-creme)"
                    strokeWidth="2"
                  />
                ) : (
                  <circle r="7" fill="#000" stroke="var(--bluey)" strokeWidth="2" />
                )}
                {l.regionId === 'federation' && l.hull === 0 && (
                  <path d="M-12-12L12 12M12-12L-12 12" stroke="var(--red)" strokeWidth="3" />
                )}
                {l.distress && l.hull > 0 && <circle cx="13" cy="-14" r="4" fill="var(--red)" />}
              </g>
            );
          })}
          {world.ships.map((s) => {
            const p = pos(s);
            return (
              <g
                key={s.id}
                transform={'translate(' + p.x + ' ' + p.y + ') scale(' + markerScale + ')'}
                {...interactive({ type: 'ship', id: s.id }, s.name)}
              >
                <circle r="15" fill="transparent" />
                {active(s.id) && (
                  <circle
                    className="selection-reticle"
                    r="18"
                    fill="none"
                    stroke="var(--almond-creme)"
                  />
                )}
                <path
                  d="M0-9L7 7 0 4 -7 7Z"
                  transform={'rotate(' + ((s.heading * 180) / Math.PI + 90) + ')'}
                  fill="var(--bluey)"
                  stroke="var(--almond-creme)"
                />
                {s.status === 'mission' && (
                  <circle r="12" fill="none" stroke="var(--bluey)" strokeDasharray="2 4" />
                )}
              </g>
            );
          })}
          {world.contacts
            .filter((c) => c.live || layers.Intelligence)
            .map((c) => {
              const p = pos(c);
              return (
                <g
                  key={c.id}
                  opacity={
                    c.live ? 1 : Math.max(0.2, 1 - (world.time - c.lastSeen) / RULES.intelTTL)
                  }
                  transform={'translate(' + p.x + ' ' + p.y + ') scale(' + markerScale + ')'}
                  {...interactive({ type: 'contact', id: c.id }, c.name ?? '未知接触 ' + c.id)}
                >
                  <circle r="19" fill="transparent" />
                  <path
                    d="M0-11L11 0 0 11 -11 0Z"
                    fill="#000"
                    stroke={c.hostile ? 'var(--red)' : 'var(--african-violet)'}
                    strokeWidth="2"
                    strokeDasharray={c.live ? '' : '3 3'}
                  />
                  <text y="4" textAnchor="middle" fill="var(--almond-creme)">
                    {c.level === 'CONTACT' ? '?' : '!'}
                  </text>
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
          {selection?.type === 'point' && (
            <g
              transform={'translate(' + pos(selection).x + ' ' + pos(selection).y + ')'}
              stroke="var(--almond-creme)"
            >
              <circle r="14" fill="none" />
              <path d="M-22 0H22M0-22V22" />
            </g>
          )}
        </svg>
      </div>
      <div className="map-status">
        <span>DAWN SECTOR · DRAG / ZOOM / SELECT</span>
        <div className="camera-controls">
          <LcarsButton
            sound="navigation"
            aria-label="缩小地图"
            disabled={camera.k <= 1.001}
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
            disabled={camera.k >= 7.999}
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
            onClick={() => {
              cancelAnimationFrame(frame.current);
              commit(fitCamera(camera.width, camera.height));
            }}
          >
            FIT
          </LcarsButton>
          <b>{camera.k.toFixed(1)}×</b>
        </div>
      </div>
    </section>
  );
}
