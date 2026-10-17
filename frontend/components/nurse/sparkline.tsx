/** One metric over 8 x 24h windows (oldest left, last 24h right). The dashed line is the
 *  baseline (mean of the earlier windows). Ported from the old nurse dashboard, restyled
 *  with v0's tokens instead of bespoke CSS. */
export function Sparkline({
  values,
  label,
  format,
  flagged,
}: {
  values: (number | null)[]
  label: string
  format: (v: number) => string
  flagged: boolean
}) {
  const W = 160
  const H = 44
  const PAD = 5
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">no data</span>
      </div>
    )
  }
  const max = Math.max(...nums, 0.001)
  const min = Math.min(...nums, 0)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (values.length - 1)
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD)
  const pts = values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)))
  const path = pts.reduce<string>((acc, p, i) => {
    if (!p) return acc
    return acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
  }, '')
  const base = values.slice(0, -1).filter((v): v is number => v !== null)
  const mean = base.length ? base.reduce((a, b) => a + b, 0) / base.length : null
  const last = values[values.length - 1]
  const lineColor = flagged ? 'text-[oklch(0.52_0.13_70)]' : 'text-muted-foreground'

  return (
    <figure className="m-0">
      <figcaption className="flex items-center justify-between gap-2 text-xs">
        <span className={flagged ? 'font-semibold text-[oklch(0.52_0.13_70)]' : 'text-muted-foreground'}>{label}</span>
        <span className="font-mono tabular-nums text-foreground">{last === null ? '—' : format(last)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`${label}: ${values.map((v) => (v === null ? 'no data' : format(v))).join(', ')}`}
      >
        {mean !== null && (
          <line x1={PAD} x2={W - PAD} y1={y(mean)} y2={y(mean)} className="text-border" stroke="currentColor" strokeDasharray="2 3" />
        )}
        <path d={path} className={lineColor} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(
          (p, i) =>
            p && (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={i === pts.length - 1 ? 4 : 2.5}
                className={i === pts.length - 1 ? 'text-foreground' : lineColor}
                fill="currentColor"
              />
            ),
        )}
      </svg>
    </figure>
  )
}
