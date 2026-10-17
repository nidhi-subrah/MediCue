'use client'

import { useState } from 'react'
import type { CareForecast } from '@/lib/types'
import { ChartCard, hourLabel } from './common'
import { PatientForecastChart } from './forecast-patient'

/** The whole unit's expected requests per hour, for staffing. */
export function ForecastBusyHours({ f }: { f: CareForecast }) {
  const max = Math.max(0.5, ...f.unit.map((u) => u.expected))
  const peak = f.unit.reduce((a, b) => (b.expected > a.expected ? b : a), f.unit[0])
  const total = f.unit.reduce((s, u) => s + u.expected, 0)
  // the quietest 2-hour stretch
  let quiet = 0
  for (let i = 1; i < f.unit.length - 1; i++) {
    if (f.unit[i].expected + f.unit[i + 1].expected < f.unit[quiet].expected + f.unit[quiet + 1].expected) quiet = i
  }
  const bullets: React.ReactNode[] = peak?.expected
    ? [
        <>About <strong>{Math.round(total)} requests</strong> expected across the unit in the next 12 hours</>,
        <>Busiest around <strong>{hourLabel(peak.start)}</strong></>,
        <>Quietest: <strong>{hourLabel(f.unit[quiet].start)}</strong> to {hourLabel(f.unit[Math.min(quiet + 2, f.unit.length - 1)].start)}</>,
      ]
    : [<>A quiet 12 hours expected</>]
  return (
    <ChartCard id="busy" question="When will the unit be busiest?" bullets={bullets} chartLabel="See by hour">
      <ol className="grid items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${f.unit.length}, minmax(0, 1fr))` }}
          aria-label="Expected requests per hour">
        {f.unit.map((u) => (
          <li key={u.start} className="flex flex-col items-center gap-1">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{u.expected.toFixed(1)}</span>
            <span className="w-full rounded-t-md bg-primary" style={{ height: `${Math.max(4, (u.expected / max) * 120)}px`,
                                                                       opacity: u === peak ? 1 : 0.55 }}
                  aria-label={`${hourLabel(u.start)}: about ${u.expected.toFixed(1)} requests`} />
            <span className="text-xs text-muted-foreground">{hourLabel(u.start)}</span>
          </li>
        ))}
      </ol>
    </ChartCard>
  )
}

/** Each patient's top expected needs in the next 4 hours, with the reason; the 12-hour charts behind a toggle. */
export function ForecastWhy({ f }: { f: CareForecast }) {
  const [pick, setPick] = useState<string>(f.patients[0]?.patient_id)
  const chosen = f.patients.find((p) => p.patient_id === pick)
  const bullets: React.ReactNode[] = f.patients.map((p) => {
    if (!p.why.length) return <><strong>{p.name}</strong>: nothing in particular expected</>
    const reason = p.why.find((w) => w.source === 'gemini')?.reason
    return (
      <>
        <strong>{p.name}</strong>: {p.why.map((w) => w.label.toLowerCase()).join(', ')}
        {reason && <span className="block text-base text-muted-foreground">{reason}</span>}
      </>
    )
  })
  return (
    <ChartCard id="why" question="What should I be ready for in the next 4 hours?" bullets={bullets} chartLabel="See the next 12 hours">
      <label className="flex items-center gap-2 self-start text-sm">
        <span className="text-muted-foreground">Patient</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-10 rounded-full border border-border bg-card px-3 font-semibold">
          {f.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
        </select>
      </label>
      {chosen && <PatientForecastChart f={f} p={chosen} />}
    </ChartCard>
  )
}

/** Yesterday's forecast against what happened: how far to trust it. */
export function ForecastCheck({ f }: { f: CareForecast }) {
  const { points, expected_total, actual_total } = f.check
  const W = 680
  const H = 90
  const max = Math.max(1, ...points.map((p) => Math.max(p.expected, p.actual)))
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * W
  const y = (v: number) => 6 + (1 - v / max) * (H - 6)
  const line = (key: 'expected' | 'actual') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const off = expected_total ? Math.round((Math.abs(actual_total - expected_total) / expected_total) * 100) : null
  const bullets: React.ReactNode[] = off === null
    ? [<>Not enough history to check yet</>]
    : [<>Yesterday we expected about <strong>{Math.round(expected_total)}</strong> requests; there were <strong>{actual_total}</strong> ({off}% {actual_total >= expected_total ? 'more' : 'fewer'})</>]
  return (
    <ChartCard id="check" question="How good was yesterday's forecast?" bullets={bullets} chartLabel="See by hour">
      <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label={`Expected ${Math.round(expected_total)}, actual ${actual_total}`}>
        <path d={line('expected')} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 4" />
        <path d={line('actual')} fill="none" stroke="var(--foreground)" strokeWidth={2} />
        {points.map((p, i) => i % 6 === 0 && (
          <text key={p.start} x={x(i)} y={H + 14} textAnchor={i ? 'middle' : 'start'} fontSize="11" fill="var(--muted-foreground)">{hourLabel(p.start)}</text>
        ))}
      </svg>
      <p className="flex gap-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-primary" />Forecast (past patterns only)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-foreground" />What happened</span>
      </p>
    </ChartCard>
  )
}
