'use client'

import type { CareForecast, ForecastPatient } from '@/lib/types'
import { GROUP_COLOR, Legend, Notice, hourLabel } from './common'

const W = 680
const H = 200
const LEFT = 30
const TOP = 12
const LEAD = 0.28   // share of the width given to the faint lead-in of the last hours

/** Expected requests per hour for one patient: stacked by type, with a 10th-90th percentile band. */
function ForecastChart({ p, groups }: { p: ForecastPatient; groups: CareForecast['groups'] }) {
  const hours = p.hours
  const lead = p.lead_in
  const max = Math.max(0.5, ...hours.map((h) => h.high), ...lead.map((l) => l.requests))
  const y = (v: number) => TOP + (1 - v / max) * (H - TOP)
  const leadW = (W - LEFT) * LEAD
  const xLead = (i: number) => LEFT + (lead.length > 1 ? (i / (lead.length - 1)) * leadW : 0)
  const xF = (i: number) => LEFT + leadW + ((i + 0.5) / hours.length) * (W - LEFT - leadW)

  // stacked area, one band per type, bottom to top
  let base = hours.map(() => 0)
  const layers = groups.map((g) => {
    const top = hours.map((h, i) => base[i] + (h.by_group[g.id] ?? 0))
    const d = [
      ...top.map((v, i) => `${i ? 'L' : 'M'}${xF(i).toFixed(1)},${y(v).toFixed(1)}`),
      ...base.map((v, i) => `L${xF(hours.length - 1 - i).toFixed(1)},${y(base[hours.length - 1 - i]).toFixed(1)}`),
    ].join(' ') + 'Z'
    base = top
    return { g, d }
  })
  const band = [
    ...hours.map((h, i) => `${i ? 'L' : 'M'}${xF(i).toFixed(1)},${y(h.high).toFixed(1)}`),
    ...hours.slice().reverse().map((h, i) => `L${xF(hours.length - 1 - i).toFixed(1)},${y(h.low).toFixed(1)}`),
  ].join(' ') + 'Z'
  const leadPath = lead.map((l, i) => `${i ? 'L' : 'M'}${xLead(i).toFixed(1)},${y(l.requests).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H + 26}`} width="100%" role="img"
         aria-label={`${p.name}, expected requests per hour: ${hours.map((h) => `${hourLabel(h.start)} ${h.expected.toFixed(1)}`).join(', ')}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={LEFT} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray={f ? '3 4' : undefined} />
          <text x={LEFT - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">{(max * f).toFixed(1)}</text>
        </g>
      ))}
      {lead.length > 1 && (
        <g opacity={0.45}>
          <path d={leadPath} fill="none" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="1 3" strokeLinecap="round" />
          <text x={LEFT + 2} y={H + 18} fontSize="11" fill="var(--muted-foreground)">Last {lead.length} h</text>
        </g>
      )}
      <line x1={LEFT + leadW} x2={LEFT + leadW} y1={TOP} y2={H} stroke="var(--foreground)" opacity={0.35} />
      <text x={LEFT + leadW + 4} y={TOP + 10} fontSize="11" fill="var(--muted-foreground)">Now</text>
      <path d={band} fill="var(--primary)" opacity={0.1}><title>Likely range (10th to 90th percentile)</title></path>
      {layers.map(({ g, d }) => <path key={g.id} d={d} fill={GROUP_COLOR[g.id]} opacity={0.85}><title>{g.label}</title></path>)}
      {hours.map((h, i) => (i % 3 === 0 || i === hours.length - 1) && (
        <text key={h.start} x={xF(i)} y={H + 18} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{hourLabel(h.start)}</text>
      ))}
    </svg>
  )
}

/** One patient's next 12 hours as a chart, for behind "See chart". */
export function PatientForecastChart({ f, p }: { f: CareForecast; p: ForecastPatient }) {
  if (!p.hours.length) return <Notice>No past requests for {p.name} yet, so there is nothing to base a forecast on.</Notice>
  return (
    <div className="flex flex-col gap-3">
      {!p.enough_history && <Notice>{p.name} arrived recently ({p.history_days} days of history), so this is rough.</Notice>}
      <Legend groups={f.groups} />
      <ForecastChart p={p} groups={f.groups} />
      <p className="text-sm text-muted-foreground">Expected requests per hour by type. The shaded band is the likely range.</p>
    </div>
  )
}
