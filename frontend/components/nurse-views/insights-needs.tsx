'use client'

import { useState } from 'react'
import type { UnitInsights } from '@/lib/types'
import { ChartCard, GROUP_COLOR, Legend, dayLabel } from './common'

const H = 180
const W = 640
const LEFT = 28
const TOP = 26

/** Stacked bars per local day by request type, with chart changes (medication, procedures) marked. */
export function InsightsNeeds({ data }: { data: UnitInsights }) {
  const { needs_by_type: n, heatmap } = data
  const [patient, setPatient] = useState<string>('all')
  const days = n.days.map((d) => ({
    day: d.day,
    counts: patient === 'all' ? d.counts : Object.fromEntries(n.groups.map((g) => [g.id, d.by_patient[patient]?.[g.id] ?? 0])),
  }))
  const markers = n.markers.filter((m) => patient === 'all' || m.patient_id === patient)
  const totals = days.map((d) => Object.values(d.counts).reduce((a, b) => a + b, 0))
  const max = Math.max(1, ...totals)
  const slot = (W - LEFT) / days.length
  const barW = Math.max(6, slot * 0.62)
  const y = (v: number) => TOP + (1 - v / max) * (H - TOP)

  const first = totals.slice(0, Math.floor(totals.length / 2)).filter((t) => t > 0)
  const last = totals.slice(Math.floor(totals.length / 2)).filter((t) => t > 0)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const groupTotals = n.groups.map((g) => ({ g, n: days.reduce((s, d) => s + (d.counts[g.id] ?? 0), 0) }))
  const top = groupTotals.reduce((a, b) => (b.n > a.n ? b : a), groupTotals[0])
  const trend = avg(last) > avg(first) * 1.2 ? 'rising' : avg(last) < avg(first) * 0.8 ? 'falling' : 'steady'
  const topTwo = [...groupTotals].sort((a, b) => b.n - a.n).filter((x) => x.n).slice(0, 2)
  const bullets: React.ReactNode[] = top?.n
    ? [
        <>Most asked for: {topTwo.map((x, i) => <span key={x.g.id}>{i ? ', ' : ''}<strong>{x.g.label.toLowerCase()}</strong> ({x.n})</span>)}</>,
        <>Requests per day are <strong>{trend}</strong> (about {Math.round(avg(first))} → {Math.round(avg(last))} a day)</>,
        ...markers.map((m) => <>Chart change for <strong>{m.name}</strong> on {dayLabel(m.day)}: {m.label}</>),
      ]
    : ['No requests in this period']

  return (
    <ChartCard
      id="needs"
      question="What are they asking for?"
      bullets={bullets}
      chartLabel="See by day"
      actions={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Show</span>
          <select value={patient} onChange={(e) => setPatient(e.target.value)}
                  className="min-h-10 rounded-full border border-border bg-card px-3 font-semibold">
            <option value="all">Whole unit</option>
            {heatmap.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
          </select>
        </label>
      }
    >
      <Legend groups={n.groups} />
      <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" role="img"
           aria-label={days.map((d, i) => `${dayLabel(d.day)}: ${totals[i]} requests`).join('; ')}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={LEFT} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray={f ? '3 4' : undefined} />
            <text x={LEFT - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">{Math.round(max * f)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = LEFT + slot * i + slot / 2
          let acc = 0
          return (
            <g key={d.day}>
              {n.groups.map((g) => {
                const v = d.counts[g.id] ?? 0
                if (!v) return null
                const top = y(acc + v)
                const h = y(acc) - top
                acc += v
                return <rect key={g.id} x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 0)} rx={2} fill={GROUP_COLOR[g.id]}>
                  <title>{`${dayLabel(d.day)} · ${g.label}: ${v}`}</title>
                </rect>
              })}
              {(i % Math.ceil(days.length / 7) === 0 || i === days.length - 1) && (
                <text x={cx} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{dayLabel(d.day)}</text>
              )}
            </g>
          )
        })}
        {markers.map((m, k) => {
          const i = days.findIndex((d) => d.day === m.day)
          if (i < 0) return null
          const cx = LEFT + slot * i + slot / 2
          return (
            <g key={k}>
              <line x1={cx} x2={cx} y1={8} y2={H} stroke="var(--foreground)" strokeDasharray="2 3" opacity={0.5} />
              <path d={`M${cx},4 l9,4 l-9,4 z`} fill="var(--foreground)"><title>{`${m.name}: ${m.label}`}</title></path>
            </g>
          )
        })}
      </svg>
      {markers.length > 0 && <p className="text-sm text-muted-foreground">Flags above the bars mark chart changes.</p>}
    </ChartCard>
  )
}
