'use client'

import { useState } from 'react'
import type { CareForecast, RiskProjection } from '@/lib/types'
import { ChartCard, LevelChip, dayLabel, names, whenLabel } from './common'

const W = 320
const H = 120
const TOP = 8
const y = (v: number) => TOP + (1 - v) * (H - TOP)
const LEVEL_WORD = { green: 'low', amber: 'amber', red: 'red' } as const

/** One risk: the last 72 h (solid), the next 24 h projected (dashed, with a widening band). */
function RiskChart({ r }: { r: RiskProjection }) {
  const pts = [...r.history.map((h) => ({ t: h.start, v: h.score })), ...r.ahead.map((a) => ({ t: a.start, v: a.score }))]
  const t0 = new Date(pts[0].t).getTime()
  const t1 = new Date(pts[pts.length - 1].t).getTime()
  const x = (iso: string) => ((new Date(iso).getTime() - t0) / (t1 - t0 || 1)) * W
  const hist = r.history.map((h, i) => `${i ? 'L' : 'M'}${x(h.start).toFixed(1)},${y(h.score).toFixed(1)}`).join(' ')
  const lastH = r.history[r.history.length - 1]
  const ahead = [`M${x(lastH.start).toFixed(1)},${y(lastH.score).toFixed(1)}`,
                 ...r.ahead.map((a) => `L${x(a.start).toFixed(1)},${y(a.score).toFixed(1)}`)].join(' ')
  const band = [`M${x(lastH.start).toFixed(1)},${y(lastH.score).toFixed(1)}`,
                ...r.ahead.map((a) => `L${x(a.start).toFixed(1)},${y(a.high).toFixed(1)}`),
                ...r.ahead.slice().reverse().map((a) => `L${x(a.start).toFixed(1)},${y(a.low).toFixed(1)}`), 'Z'].join(' ')
  const now = x(lastH.start)
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img"
         aria-label={`${r.label}: now ${Math.round(lastH.score * 100)}%, in 24 hours about ${Math.round(r.ahead[r.ahead.length - 1].score * 100)}%. ${r.caption}.`}>
      <rect x={0} y={y(1)} width={W} height={y(r.red) - y(1)} fill="var(--urgent)" opacity={0.06} />
      <rect x={0} y={y(r.red)} width={W} height={y(r.amber) - y(r.red)} fill="var(--caution)" opacity={0.08} />
      <line x1={0} x2={W} y1={y(r.red)} y2={y(r.red)} stroke="var(--urgent)" strokeDasharray="4 4" opacity={0.7} />
      <line x1={0} x2={W} y1={y(r.amber)} y2={y(r.amber)} stroke="var(--caution)" strokeDasharray="4 4" opacity={0.8} />
      <text x={W - 2} y={y(r.red) - 3} textAnchor="end" fontSize="10" fill="var(--urgent)">red</text>
      <text x={W - 2} y={y(r.amber) - 3} textAnchor="end" fontSize="10" fill="var(--caution)">amber</text>
      <line x1={now} x2={now} y1={TOP} y2={H} stroke="var(--foreground)" opacity={0.3} />
      <path d={band} fill="var(--primary)" opacity={0.12} />
      <path d={hist} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" />
      <path d={ahead} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 4" />
      <text x={2} y={H + 14} fontSize="10" fill="var(--muted-foreground)">{dayLabel(r.history[0].start)}</text>
      <text x={now} y={H + 14} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">now</text>
      <text x={W - 2} y={H + 14} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">+24 h</text>
    </svg>
  )
}

const heading = (r: RiskProjection) => r.level !== 'green' || r.caption.startsWith('May reach') || r.caption === 'Rising slowly'

/** Every patient's risks that are raised or heading up, as bullets; the trajectories behind "See chart". */
export function ForecastRisks({ f }: { f: CareForecast }) {
  const rows = f.patients.flatMap((p) => p.risk.filter(heading).map((r) => ({ p, r })))
    .sort((a, b) => Number(b.r.caption.startsWith('May reach')) - Number(a.r.caption.startsWith('May reach')))
  const steady = f.patients.filter((p) => p.risk.length && !p.risk.some(heading)).map((p) => p.name)
  const newcomers = f.patients.filter((p) => !p.risk.length).map((p) => p.name)
  const [pick, setPick] = useState<string>(rows[0]?.p.patient_id ?? f.patients[0]?.patient_id)
  const chosen = f.patients.find((p) => p.patient_id === pick)

  const bullets: React.ReactNode[] = rows.map(({ p, r }) => (
    <><strong>{p.name}</strong> · {r.label.toLowerCase()} is <strong>{LEVEL_WORD[r.level]}</strong>: {r.caption.toLowerCase()}</>
  ))
  if (!rows.length) bullets.push(<>No one&apos;s risks are heading up</>)
  if (steady.length && rows.length) bullets.push(<>Steady: {names(steady)}</>)
  if (newcomers.length) bullets.push(<>Too new to tell yet (need about 5 days): {names(newcomers)}</>)

  return (
    <ChartCard id="risks" question="Whose risks are heading up?" bullets={bullets}>
      <label className="flex items-center gap-2 self-start text-sm">
        <span className="text-muted-foreground">Patient</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-h-10 rounded-lg border border-border bg-card px-3 font-semibold">
          {f.patients.filter((p) => p.risk.length).map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name}</option>)}
        </select>
      </label>
      {chosen && chosen.risk.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {chosen.risk.map((r) => (
            <figure key={r.risk} className="m-0 flex flex-col gap-2 rounded-2xl bg-surface p-3">
              <figcaption className="flex flex-col gap-1.5">
                <span className="font-semibold">{r.label}</span>
                <LevelChip level={r.level}>{r.caption}</LevelChip>
              </figcaption>
              <RiskChart r={r} />
            </figure>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">Solid line: the last 3 days. Dashed: the next 24 hours, with the likely range shaded.</p>
    </ChartCard>
  )
}

/** When the risk engine first raised each concern for these patients, and the signals behind it. */
export function ForecastFlags({ f }: { f: CareForecast }) {
  const bullets: React.ReactNode[] = []
  for (const p of f.patients) {
    const byRisk = new Map<string, typeof p.flags>()
    for (const fl of p.flags) byRisk.set(fl.risk, [...(byRisk.get(fl.risk) ?? []), fl])
    for (const flags of byRisk.values()) {
      const amber = flags.find((x) => x.level === 'amber')
      const red = flags.find((x) => x.level === 'red')
      const first = amber ?? red!
      bullets.push(
        <>
          <strong>{p.name}</strong> · {first.label.toLowerCase()}: first noticed <strong>{whenLabel(first.time)}</strong>
          {red && amber && <>, red since {whenLabel(red.time)}</>}
          {first.why.length > 0 && <span className="block text-base text-muted-foreground">{first.why.join('; ')}</span>}
        </>,
      )
    }
  }
  const none = f.patients.filter((p) => !p.flags.length).map((p) => p.name)
  if (!bullets.length) bullets.push(<>Nothing has been flagged for anyone</>)
  else if (none.length) bullets.push(<>Nothing flagged for {names(none)}</>)
  return <ChartCard id="flags" question="When did the system first notice?" bullets={bullets} />
}
