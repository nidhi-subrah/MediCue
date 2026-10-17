'use client'

import { useState } from 'react'
import type { ForecastRisk } from '@/lib/types'

const W = 560
const H = 150
const PAD = { top: 10, right: 58, bottom: 26, left: 8 }
const PROJECT_H = 24

const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short' })
const whenLabel = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })
const levelWord = (score: number, r: ForecastRisk) =>
  score >= r.thresholds.elevated ? 'High' : score >= r.thresholds.watch ? 'Watch' : 'Low'

/** One risk over the last week, against the Watch and High zones, with a dashed line for where it is
 *  heading over the next day if the trend continues. Hover (or focus) a point to read it; the same
 *  values are in a table for screen readers. */
export function ForecastChart({ r, stale = false }: { r: ForecastRisk; stale?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = r.history.map((p) => ({ t: new Date(p.time).getTime(), v: p.score }))
  if (pts.length < 2) return <p className="text-sm text-muted-foreground">Not enough history for a chart yet.</p>

  const last = pts[pts.length - 1]
  const projected = r.outlook.projected_24h
  const tEnd = last.t + PROJECT_H * 3600e3
  const t0 = pts[0].t
  const x = (t: number) => PAD.left + ((t - t0) / (tEnd - t0)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const bottom = H - PAD.bottom
  const right = W - PAD.right

  const days: number[] = []
  const d = new Date(t0)
  d.setHours(0, 0, 0, 0)
  for (d.setDate(d.getDate() + 1); d.getTime() < tEnd; d.setDate(d.getDate() + 1)) days.push(d.getTime())

  const shown = hover !== null ? pts[hover] : null

  return (
    <figure className="flex flex-col gap-1">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="block text-[11px]"
             aria-label={`${r.risk_word} risk over the last week: now ${r.level_word}, ${r.trend.direction}.`}
             onMouseLeave={() => setHover(null)}>
          {/* zones: High on top, Watch below; labelled in words, colour only reinforces */}
          <rect x={PAD.left} y={y(1)} width={right - PAD.left} height={y(r.thresholds.elevated) - y(1)} className="fill-urgent-soft" />
          <rect x={PAD.left} y={y(r.thresholds.elevated)} width={right - PAD.left}
                height={y(r.thresholds.watch) - y(r.thresholds.elevated)} className="fill-caution-soft" />
          <text x={right + 6} y={(y(1) + y(r.thresholds.elevated)) / 2 + 4} className="fill-urgent" fontWeight={600}>High</text>
          <text x={right + 6} y={(y(r.thresholds.elevated) + y(r.thresholds.watch)) / 2 + 4} className="fill-caution" fontWeight={600}>Watch</text>
          <text x={right + 6} y={(y(r.thresholds.watch) + bottom) / 2 + 4} className="fill-muted-foreground">Low</text>
          <line x1={PAD.left} x2={right} y1={bottom} y2={bottom} className="stroke-border" />

          {days.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={bottom} y2={bottom + 4} className="stroke-border" />
              <text x={x(t) + 3} y={bottom + 16} className="fill-muted-foreground">{dayLabel(t)}</text>
            </g>
          ))}

          {/* now, and where it is heading */}
          <line x1={x(last.t)} x2={x(last.t)} y1={PAD.top} y2={bottom} className="stroke-muted-foreground" strokeWidth={1} />
          <text x={x(last.t) - 4} y={PAD.top + 10} textAnchor="end" className="fill-muted-foreground" fontWeight={600}>{stale ? 'Last data' : 'Now'}</text>
          {projected !== null && (
            <path d={`M${x(last.t)},${y(last.v)}L${x(tEnd)},${y(projected)}`} fill="none"
                  className="stroke-foreground" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
          )}
          <path d={line} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last.t)} cy={y(last.v)} r={4} className="fill-foreground stroke-card" strokeWidth={2} />

          {shown && (
            <g pointerEvents="none">
              <line x1={x(shown.t)} x2={x(shown.t)} y1={PAD.top} y2={bottom} className="stroke-foreground/40" />
              <circle cx={x(shown.t)} cy={y(shown.v)} r={4} className="fill-foreground stroke-card" strokeWidth={2} />
            </g>
          )}
          {/* hit areas: one column per point, wider than the mark */}
          {pts.map((p, i) => {
            const prev = i ? x(pts[i - 1].t) : PAD.left
            const next = i < pts.length - 1 ? x(pts[i + 1].t) : x(p.t) + 12
            const x0 = (prev + x(p.t)) / 2
            return (
              <rect key={p.t} x={i ? x0 : PAD.left} y={PAD.top} width={Math.max((x(p.t) + next) / 2 - (i ? x0 : PAD.left), 1)}
                    height={bottom - PAD.top} fill="transparent" tabIndex={-1}
                    onMouseEnter={() => setHover(i)} />
            )
          })}
        </svg>
        {shown && (
          <div className="pointer-events-none absolute top-0 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-md"
               style={{ left: `${(x(shown.t) / W) * 100}%`, transform: 'translateX(-50%)' }}>
            <span className="font-semibold">{whenLabel(shown.t)}</span> · {levelWord(shown.v, r)}
          </div>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Last 7 days{projected !== null ? '; dashed: next 24 h if the trend continues' : ''}.
      </figcaption>
      <table className="sr-only">
        <caption>{r.risk_word} risk, every 6 hours</caption>
        <thead><tr><th>Time</th><th>Level</th></tr></thead>
        <tbody>
          {pts.map((p) => <tr key={p.t}><td>{whenLabel(p.t)}</td><td>{levelWord(p.v, r)}</td></tr>)}
        </tbody>
      </table>
    </figure>
  )
}
