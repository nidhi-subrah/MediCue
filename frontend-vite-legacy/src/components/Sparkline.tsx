/**
 * One metric over 8 x 24 h windows (oldest left, last 24 h right). Single series: no legend, the title
 * names it. The dashed line is the baseline (mean of the earlier windows). Hover a point for its value.
 */
export default function Sparkline({ values, label, format, flagged }: {
  values: (number | null)[]; label: string; format: (v: number) => string; flagged: boolean;
}) {
  const W = 160, H = 44, PAD = 5;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) {
    return <div className="spark"><span className="spark-label">{label}</span><span className="muted small">no data</span></div>;
  }
  const max = Math.max(...nums, 0.001), min = Math.min(...nums, 0);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (values.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
  const pts = values.map((v, i) => (v === null ? null : [x(i), y(v)] as const));
  const path = pts.reduce((acc, p, i) => {
    if (!p) return acc;
    return acc + `${acc && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  }, "");
  const base = values.slice(0, -1).filter((v): v is number => v !== null);
  const mean = base.length ? base.reduce((a, b) => a + b, 0) / base.length : null;
  const last = values[values.length - 1];

  return (
    <figure className={`spark ${flagged ? "spark-flagged" : ""}`}>
      <figcaption>
        <span className="spark-label">{label}</span>
        <span className="spark-value">{last === null ? "—" : format(last)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={`${label}: ${values.map((v) => (v === null ? "no data" : format(v))).join(", ")}`}>
        {mean !== null && <line x1={PAD} x2={W - PAD} y1={y(mean)} y2={y(mean)} className="spark-base" />}
        <path d={path} className="spark-line" />
        {pts.map((p, i) => p && (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4 : 2.5}
                    className={i === pts.length - 1 ? "spark-last" : "spark-dot"} />
            <circle cx={p[0]} cy={p[1]} r={9} className="spark-hit">
              <title>{`${i === values.length - 1 ? "Last 24 h" : `${values.length - 1 - i} day(s) earlier`}: ${format(values[i] as number)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </figure>
  );
}
