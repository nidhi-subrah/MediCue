import type { TileOption } from "./TileGrid";
import Icon from "./Icon";

/** Areas drawn on the figure. Everything else in the option list becomes a button beside it. */
const REGIONS: { id: string; label: string; shapes: JSX.Element; lx: number; ly: number }[] = [
  { id: "head", label: "Head", lx: 100, ly: 50,
    shapes: <ellipse cx="100" cy="46" rx="30" ry="34" /> },
  { id: "chest", label: "Chest", lx: 100, ly: 134,
    shapes: <path d="M62 92h76c8 0 13 6 13 14v62H49v-62c0-8 5-14 13-14Z" /> },
  { id: "belly", label: "Belly", lx: 100, ly: 214,
    shapes: <path d="M49 172h102v70c0 8-5 14-13 14H62c-8 0-13-6-13-14Z" /> },
  { id: "arms_legs", label: "Arms & legs", lx: 100, ly: 448,
    shapes: <>
      <rect x="14" y="96" width="31" height="172" rx="15" />
      <rect x="155" y="96" width="31" height="172" rx="15" />
      <rect x="52" y="260" width="45" height="160" rx="18" />
      <rect x="103" y="260" width="45" height="160" rx="18" />
    </> },
];

export default function BodyMap({ options }: { options: TileOption[] }) {
  const byKey = Object.fromEntries(options.map((o) => [o.key, o]));
  const onFigure = REGIONS.filter((r) => byKey[r.id]);
  const others = options.filter((o) => !REGIONS.some((r) => r.id === o.key));

  return (
    <div className="bodymap">
      <svg className="bodymap-figure" viewBox="0 0 200 470" role="group" aria-label="Body">
        {onFigure.map((r) => {
          const o = byKey[r.id];
          return (
            <g key={r.id} className="region" role="button" tabIndex={0} aria-label={o.label}
               onClick={o.onSelect}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onSelect(); } }}>
              {r.shapes}
              <text x={r.lx} y={r.ly} textAnchor="middle" dominantBaseline="middle">{o.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="bodymap-side" role="group" aria-label="Other places">
        {others.map((o) => (
          <button key={o.key} className="side-option" onClick={o.onSelect}>
            <Icon name={o.icon ?? o.key} size={30} />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
