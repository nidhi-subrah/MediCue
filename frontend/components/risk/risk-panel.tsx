'use client'

import { useState } from 'react'
import { useRiskOverview } from '@/lib/live/risk'
import { pct } from '@/lib/services/backend'
import type { RiskContributor, RiskKey, RiskPatient, RiskScore } from '@/lib/types'
import { cn } from '@/lib/utils'
import { LEVEL, LevelBadge, SyntheticTag } from './level'

const RISKS: { key: RiskKey; short: string }[] = [
  { key: 'fall', short: 'Fall' },
  { key: 'dehydration', short: 'Dehydration' },
  { key: 'delirium', short: 'Delirium/infection' },
]
const ARROW = { up: '↑', down: '↓', flat: '→' } as const

/** Highest score per 6 h over 7 days on a 0-100% scale; the watch and elevated thresholds are dashed. */
function RiskSpark({ s }: { s: RiskScore }) {
  const values = s.spark ?? []
  const W = 120, H = 30, P = 3
  if (values.length < 2) return <span className="text-xs text-muted-foreground">no trend yet</span>
  const x = (i: number) => P + (i * (W - 2 * P)) / (values.length - 1)
  const y = (v: number) => H - P - v * (H - 2 * P)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const last = values[values.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
         aria-label={`${s.label}, last 7 days: from ${pct(values[0])} to ${pct(last)}, highest ${pct(Math.max(...values))}`}>
      {[s.thresholds.watch, s.thresholds.elevated].map((t) => (
        <line key={t} x1={P} x2={W - P} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} strokeDasharray="2 3" />
      ))}
      <path d={d} fill="none" className="stroke-foreground" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.5} className="fill-foreground" />
    </svg>
  )
}

function Chip({ short, s }: { short: string; s: RiskScore }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-xl border border-border border-l-4 bg-card p-3', LEVEL[s.level].edge)}>
      <span className="text-sm font-semibold">{short}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <LevelBadge level={s.level} enough={s.enough_data} />
        <span className="font-mono text-sm tabular-nums text-muted-foreground">{pct(s.score)}</span>
      </div>
      <RiskSpark s={s} />
    </div>
  )
}

function Contributor({ c }: { c: RiskContributor }) {
  return (
    <li className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-b border-border py-1.5 text-sm sm:grid-cols-[minmax(9rem,1.4fr)_4.5rem_1.4fr_4rem]">
      <span className="font-medium">{c.label}</span>
      <span className="font-mono">{ARROW[c.direction]} {c.direction}</span>
      <span className="text-muted-foreground">{c.text}</span>
      <span className="font-mono">{Math.abs(c.z).toFixed(1)} SD</span>
    </li>
  )
}

function Row({ p }: { p: RiskPatient }) {
  const scores = RISKS.flatMap((r) => (p.risks[r.key] ? [{ ...r, s: p.risks[r.key] as RiskScore }] : []))
  const byConcern = [...scores].sort((a, b) => LEVEL[b.s.level].rank - LEVEL[a.s.level].rank || b.s.score - a.s.score)
  return (
    <article aria-label={`Risk for ${p.name}`} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm text-muted-foreground">{p.room}</span>
        <span className="font-semibold">{p.name}</span>
        {p.synthetic && <SyntheticTag>Synthetic</SyntheticTag>}
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {scores.map(({ key, short, s }) => <Chip key={key} short={short} s={s} />)}
      </div>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer font-semibold text-primary">Why</summary>
        {byConcern.map(({ key, s }) => (
          <section key={key} className="mt-3">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <LevelBadge level={s.level} enough={s.enough_data} /> {s.label} · {pct(s.score)}
            </h3>
            {s.top.length > 0 ? (
              <ul className="mt-1">{s.top.map((c) => <Contributor key={c.signal} c={c} />)}</ul>
            ) : (
              <p className="mt-1 text-muted-foreground">Every signal is within this patient&apos;s usual range.</p>
            )}
            {s.missing.length > 0 && (
              <p className="mt-1 text-muted-foreground">Not enough data: {s.missing.map((m) => m.label.toLowerCase()).join(', ')}.</p>
            )}
          </section>
        ))}
        <p className="mt-3 text-xs text-muted-foreground">
          Each signal is compared with this patient&apos;s own previous 7 days (SD = standard deviations from usual).
          Flags are prompts for clinician review, not diagnoses.
        </p>
      </details>
    </article>
  )
}

export function RiskPanel() {
  const { data, error } = useRiskOverview()
  const [showCalm, setShowCalm] = useState(false)
  const rank = (p: RiskPatient) => Math.max(0, ...Object.values(p.risks).flatMap((s) => (s ? [LEVEL[s.level].rank] : [])))
  const patients = data?.patients ?? []
  const concerning = patients.filter((p) => rank(p) > 0)
  const calm = patients.filter((p) => rank(p) === 0)

  return (
    <section aria-labelledby="risk-h" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h2 id="risk-h" className="text-xl font-semibold">Risk</h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <SyntheticTag />{data && `${concerning.length} on watch or elevated`}
        </p>
      </header>
      {error && <p className="text-sm text-urgent">{error}</p>}
      {data && <p className="text-sm text-muted-foreground">{data.notice}</p>}
      {data && concerning.length === 0 && (
        <p className="rounded-2xl border border-border bg-card p-6 text-muted-foreground">No patient is on watch or elevated.</p>
      )}
      {concerning.map((p) => <Row key={p.patient_id} p={p} />)}
      {calm.length > 0 && (
        <button type="button" aria-expanded={showCalm} onClick={() => setShowCalm((v) => !v)}
                className="self-start text-base font-semibold text-primary underline-offset-4 hover:underline">
          {showCalm ? 'Hide' : 'Show'} {calm.length} patients with every risk low
        </button>
      )}
      {showCalm && calm.map((p) => <Row key={p.patient_id} p={p} />)}
    </section>
  )
}
