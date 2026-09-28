import type { Ship } from '../../engine/types';
export function ShipArt({ ship, large = false }: { ship: Ship; large?: boolean }) {
  return (
    <svg
      className={`ship-art ${large ? 'large' : ''} ${ship.id}`}
      viewBox="0 0 240 150"
      aria-label={`${ship.name} 舰船示意图`}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M30 75H210M120 14V140" opacity=".18" strokeDasharray="3 5" />
        <ellipse cx="120" cy="50" rx={ship.id === 'meridian' ? 27 : 48} ry="27" />
        <ellipse cx="120" cy="50" rx="18" ry="12" />
        <ellipse cx="120" cy="50" rx="5" ry="4" />
        <path d="M106 76L104 125Q120 139 136 125L134 76M104 98L73 116M136 98L167 116M106 107L73 125M134 107L167 125M113 78V116M127 78V116" />
        <path d="M61 67Q67 59 73 67V137H61ZM167 67Q173 59 179 67V137H167Z" />
        <path d="M64 79H70M170 79H176M104 120H136" />
        <path d="M78 40L100 46M140 46L162 40M79 58L100 54M140 54L161 58" opacity=".6" />
      </g>
      <g fill="currentColor">
        <rect x="63" y="66" width="8" height="6" />
        <rect x="169" y="66" width="8" height="6" />
      </g>
    </svg>
  );
}
export function Meter({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  return (
    <div className="meter">
      <div>
        <span>{label}</span>
        <strong>
          {Math.ceil(value)}
          <small> / {max}</small>
        </strong>
      </div>
      <div className="meter-track">
        <i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </div>
    </div>
  );
}
export function Bar({ children, code = '' }: { children: React.ReactNode; code?: string }) {
  return (
    <div className="section-bar">
      <span>{children}</span>
      <i />
      <b>{code}</b>
    </div>
  );
}
