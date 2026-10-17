'use client'

import { ArrowDownRight, ArrowRight, ArrowUpRight, ClipboardCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useForecast } from '@/lib/live/risk'
import type { ForecastPatient, ForecastRisk, RiskFlagLevel } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ForecastChart } from './forecast-chart'
import { LevelBadge, SyntheticTag } from './level'

const TREND = {
  rising: { icon: ArrowUpRight, word: 'Rising', className: 'text-urgent' },
  steady: { icon: ArrowRight, word: 'Steady', className: 'text-muted-foreground' },
  easing: { icon: ArrowDownRight, word: 'Easing', className: 'text-success' },
  unknown: { icon: ArrowRight, word: 'Not enough history', className: 'text-muted-foreground' },
} as const

const EDGE: Record<RiskFlagLevel, string> = {
  elevated: 'border-l-urgent',
  watch: 'border-l-caution',
  low: 'border-l-border',
}

function when(hours: number) {
  if (hours < 12) return 'in the next few hours'
  if (hours < 30) return 'within about a day'
  return `within about ${Math.round(hours / 24)} days`
}

function Outlook({ r }: { r: ForecastRisk }) {
  const t = TREND[r.trend.direction]
  return (
    <p className={cn('inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold', t.className)}>
      <t.icon className="size-4 shrink-0" aria-hidden="true" />
      {t.word}
      {r.outlook.eta_hours !== null && r.outlook.next_word && (
        <span className="font-normal text-foreground">
          · could reach <strong>{r.outlook.next_word}</strong> {when(r.outlook.eta_hours)} if this continues
        </span>
      )}
    </p>
  )
}

function RiskBlock({ r, open, stale }: { r: ForecastRisk; open: boolean; stale: boolean }) {
  const checks = [...new Set(r.changes.flatMap((c) => (c.check ? [c.check] : [])))]
  return (
    <section className={cn('flex flex-col gap-3 border-l-4 pl-4', EDGE[r.level])}>
      <header className="flex flex-col gap-1">
        <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-bold">
          {r.risk_word} risk
          <LevelBadge level={r.level} enough={r.enough_data} />
        </h3>
        <Outlook r={r} />
      </header>

      {r.changes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground">What&apos;s changed</h4>
          <ul className="mt-1 flex flex-col gap-1">
            {r.changes.map((c) => (
              <li key={c.signal} className="text-base">
                <span className="font-semibold">{c.what}</span>{' '}
                <span className="text-muted-foreground">({c.detail})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checks.length > 0 && (
        <div className="rounded-2xl bg-surface p-3">
          <h4 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <ClipboardCheck className="size-4" aria-hidden="true" /> Things to check
          </h4>
          <ul className="mt-1 list-disc pl-5 text-base">
            {checks.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}

      {open && <ForecastChart r={r} stale={stale} />}
    </section>
  )
}

function PatientCard({ p, chartOpen = false }: { p: ForecastPatient; chartOpen?: boolean }) {
  const [chart, setChart] = useState(chartOpen)
  const flagged = p.risks.filter((r) => r.needs_check)
  const lead = flagged[0] ?? p.risks[0]
  const sentence = lead.summary_ai ?? lead.summary
  return (
    <article aria-label={`Early warnings for ${p.name}`} className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 md:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm text-muted-foreground">{p.room}</span>
        <h2 className="text-xl font-bold">{p.name}</h2>
        {p.synthetic && <SyntheticTag>Practice data</SyntheticTag>}
        {p.stale && (
          <span className="text-sm text-muted-foreground">
            Last data {new Date(p.now).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })}
          </span>
        )}
      </header>
      <p className="text-lg leading-relaxed">
        {lead.summary_ai && <Sparkles className="mr-1.5 inline size-4 text-primary" aria-label="Written by AI from the engine's facts" />}
        {sentence}
      </p>
      {flagged.map((r) => <RiskBlock key={r.risk} r={r} open={chart} stale={p.stale} />)}
      {p.risks.length > flagged.length && (
        <p className="text-sm text-muted-foreground">
          {p.risks.filter((r) => !r.needs_check).map((r) => r.risk_word).join(' and ')}: low.
        </p>
      )}
      <button type="button" onClick={() => setChart((v) => !v)} aria-expanded={chart}
              className="self-start text-base font-semibold text-primary underline-offset-4 hover:underline">
        {chart ? 'Hide the week' : 'Show the week'}
      </button>
    </article>
  )
}

export function ForecastView() {
  const { data, error } = useForecast()
  const [showCalm, setShowCalm] = useState(false)
  if (error) return <p className="text-urgent">{error}</p>
  if (!data) return <p className="text-lg text-muted-foreground">Loading…</p>

  const check = data.patients.filter((p) => p.needs_check)
  const calm = data.patients.filter((p) => !p.needs_check)
  const c = data.counts

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Ward summary" className="flex flex-col gap-4 rounded-3xl border border-primary/30 bg-primary-soft p-5 md:p-6">
        <p className="text-xl font-semibold leading-relaxed text-balance">
          {data.summary_source === 'gemini' && <Sparkles className="mr-2 inline size-5 text-primary" aria-label="Written by AI" />}
          {data.ward_summary}
        </p>
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          {[
            { n: c.high, label: 'High', className: 'text-urgent' },
            { n: c.watch, label: 'Watch', className: 'text-caution' },
            { n: c.rising, label: 'Heading up', className: 'text-foreground' },
          ].map((s) => (
            <div key={s.label} className="flex items-baseline gap-2">
              <dt className="sr-only">{s.label}</dt>
              <dd className={cn('text-3xl font-bold', s.className)}>{s.n}</dd>
              <span className="text-base text-muted-foreground" aria-hidden="true">{s.label}</span>
            </div>
          ))}
        </dl>
      </section>

      {check.length === 0 && (
        <p className="rounded-3xl border border-border bg-card p-6 text-lg text-muted-foreground">
          Nobody needs an extra check right now.
        </p>
      )}
      {check.map((p, i) => <PatientCard key={p.patient_id} p={p} chartOpen={i === 0} />)}

      {calm.length > 0 && (
        <div className="flex flex-col gap-3">
          <button type="button" aria-expanded={showCalm} onClick={() => setShowCalm((v) => !v)}
                  className="self-start text-base font-semibold text-primary underline-offset-4 hover:underline">
            {showCalm ? 'Hide' : 'Show'} {calm.length} patients with every risk low
          </button>
          {showCalm && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {calm.map((p) => (
                <li key={p.patient_id} className="flex items-baseline gap-2 rounded-2xl border border-border bg-card px-4 py-3">
                  <span className="font-mono text-sm text-muted-foreground">{p.room}</span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="ml-auto text-sm text-muted-foreground">All low</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Each patient is compared with their own last 7 days. Warnings are prompts for a check, not diagnoses.
      </p>
    </div>
  )
}
