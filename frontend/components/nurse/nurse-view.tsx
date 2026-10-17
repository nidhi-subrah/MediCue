'use client'

import { ArrowRight, ChartColumn, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useNurseStation } from '@/lib/live/nurse'
import { cn } from '@/lib/utils'
import { RiskPanel } from '@/components/risk/risk-panel'
import { SilencePanel } from '@/components/risk/silence-panel'
import { AlertCard } from './alert-card'
import { DemoScenarioBar } from './demo-scenario'
import { CommunicationPanel } from './communication-panel'
import { ShiftSummary } from './shift-summary'
import { SuggestionsPanel } from './suggestions-panel'
import { Sparkline } from './sparkline'

const VIEWS = [
  { href: '/nurse/insights', title: 'Unit insights', icon: ChartColumn,
    description: 'What has happened: requests, timelines and how each patient is communicating.' },
  { href: '/nurse/forecast', title: 'Care forecast', icon: TrendingUp,
    description: 'What is likely next: expected requests, risks heading up, and what to be ready for.' },
] as const

const SPARKS: { metric: string; label: string; format: (v: number) => string }[] = [
  { metric: 'pain_needs', label: 'Pain requests', format: (v) => v.toFixed(0) },
  { metric: 'high_risk', label: 'High-risk signals', format: (v) => v.toFixed(0) },
  { metric: 'avg_tap_interval', label: 'Seconds per tap', format: (v) => `${v.toFixed(1)}s` },
  { metric: 'avg_taps', label: 'Taps per need', format: (v) => v.toFixed(1) },
]

export function NurseView() {
  const { alerts, trends, suggestions, confirm, reviewSuggestion } = useNurseStation()
  const [showDone, setShowDone] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [demoAlert, setDemoAlert] = useState<string | null>(null)   // its case packet opens when it arrives

  const open = alerts
    .filter((a) => a.status === 'open')
    .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent'))
  const doneAlerts = alerts.filter((a) => a.status !== 'open')
  const urgentCount = open.filter((a) => a.priority === 'urgent').length
  const flagged = trends.filter((t) => t.flags.length > 0)
  const stable = trends.filter((t) => t.flags.length === 0)

  return (
    <div className="flex flex-col gap-8">
    <nav aria-label="Unit views" className="grid gap-4 sm:grid-cols-2">
      {VIEWS.map((v) => (
        <Link
          key={v.href}
          href={v.href}
          className="group flex items-center gap-4 rounded-3xl border-2 border-primary/25 bg-primary-soft p-5 transition-colors hover:border-primary md:p-6"
        >
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <v.icon className="size-7" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xl font-bold">{v.title}</span>
            <span className="text-base leading-snug text-muted-foreground">{v.description}</span>
          </span>
          <ArrowRight className="size-6 shrink-0 text-primary transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </Link>
      ))}
    </nav>
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-10">
      {showSummary && <ShiftSummary onClose={() => setShowSummary(false)} />}
      <SilencePanel />
      <section aria-labelledby="alerts-h" className="flex flex-col gap-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
          <h1 id="alerts-h" className="text-2xl font-bold">Requests</h1>
          <p className="text-sm text-muted-foreground">
            {open.length === 0 ? 'None open' : `${open.length} open`}
            {urgentCount > 0 && <span className="font-semibold text-urgent"> · {urgentCount} urgent</span>}
            {!showSummary && (
              <button
                type="button"
                onClick={() => setShowSummary(true)}
                className="ml-3 inline-flex h-9 items-center rounded-full border border-border bg-card px-3 text-sm font-semibold text-foreground hover:border-primary/40"
              >
                Shift summary
              </button>
            )}
          </p>
        </header>

        <DemoScenarioBar onAlert={setDemoAlert} />

        {open.length === 0 && (
          <p className="rounded-3xl border border-border bg-card p-6 text-base text-muted-foreground">
            Nothing waiting. Requests from bedside tablets appear here as they&apos;re sent.
          </p>
        )}
        {open.map((a) => <AlertCard key={a.id} alert={a} openCase={a.id === demoAlert}
                                    onConfirm={(needId, note, helpful) => confirm(a.id, needId, note, helpful)} />)}

        {doneAlerts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="self-start text-base font-semibold text-primary underline-offset-4 hover:underline"
          >
            {showDone ? 'Hide' : 'Show'} {doneAlerts.length} confirmed
          </button>
        )}
        {showDone && doneAlerts.map((a) => <AlertCard key={a.id} alert={a} onConfirm={(needId, note, helpful) => confirm(a.id, needId, note, helpful)} />)}
      </section>
      </div>

      <div className="flex min-w-0 flex-col gap-10">
      <CommunicationPanel />
      <SuggestionsPanel items={suggestions} onReview={reviewSuggestion} />
      <RiskPanel />
      <section aria-labelledby="trends-h" className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 border-b border-border pb-3">
          <h2 id="trends-h" className="text-xl font-bold">Changes this shift</h2>
          <p className="text-sm text-muted-foreground">Last 24h against each patient&apos;s previous 7 days</p>
        </header>

        {flagged.map((t) => (
          <article key={t.patient_id} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
            <header className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-sm text-muted-foreground">{t.room}</span>
              <span className="font-semibold">{t.patient_name}</span>
              {t.mode_changes_24h > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t.mode_changes_24h} access-mode change{t.mode_changes_24h > 1 ? 's' : ''}
                </span>
              )}
            </header>
            {t.flags.map((f) => (
              <p
                key={f.metric}
                className={cn(
                  'border-l-4 pl-3 text-sm',
                  f.severity === 'attention' ? 'border-urgent text-foreground' : 'border-[oklch(0.52_0.13_70)] text-foreground',
                )}
              >
                <strong className={f.severity === 'attention' ? 'text-urgent' : 'text-[oklch(0.52_0.13_70)]'}>
                  {f.severity === 'attention' ? 'Needs attention' : 'Review'}
                </strong>{' '}
                {f.message}
              </p>
            ))}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SPARKS.map((sp) => (
                <Sparkline
                  key={sp.metric}
                  values={t.series[sp.metric] ?? []}
                  label={sp.label}
                  format={sp.format}
                  flagged={t.flags.some((f) => f.metric === sp.metric)}
                />
              ))}
            </div>
          </article>
        ))}

        {stable.length > 0 && (
          <p className="text-sm text-muted-foreground">
            No change: {stable.map((t) => `${t.patient_name} (${t.room})`).join(', ')}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Flags are prompts for clinical review, not diagnoses.</p>
      </section>
      </div>
    </div>
    </div>
  )
}
