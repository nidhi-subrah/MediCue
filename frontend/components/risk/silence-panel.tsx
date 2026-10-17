'use client'

import { Check, Plus, Tablet, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NURSE_STATION, useSilenceLadders } from '@/lib/live/risk'
import { timeAgo } from '@/lib/services/backend'
import type { SilenceLadder, SilenceStep } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SyntheticTag } from './level'

const STEP = {
  tablet: { icon: Tablet, title: 'Tablet check' },
  contact: { icon: Users, title: 'Trusted contact' },
  nurse: { icon: Plus, title: 'Nurse' },
} as const

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function countdown(deadline: string, now: number) {
  const s = Math.max(0, Math.round((new Date(deadline).getTime() - now) / 1000))
  return s === 0 ? 'due now' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function who(l: SilenceLadder, kind: SilenceStep['kind']) {
  if (kind === 'tablet') return `${l.patient_name}, on the bedside tablet`
  if (kind === 'contact') return l.contact_name ?? 'No trusted contact on file'
  return NURSE_STATION
}

function ackName(l: SilenceLadder, s: SilenceStep) {
  if (s.ack_role === 'contact') return l.contact_name ?? s.ack_by
  if (s.ack_role === 'patient') return l.patient_name
  return s.ack_by
}

function status(l: SilenceLadder, s: SilenceStep, now: number) {
  if (s.status === 'acknowledged') {
    return `${s.outcome === 'concern' ? 'Raised a concern' : 'Acknowledged'} by ${ackName(l, s)} at ${clock(s.ack_at as string)}`
  }
  if (s.status === 'timed_out') return `No answer by ${clock(s.deadline)}`
  if (s.kind === 'nurse') {
    return `Waiting for a nurse · ${s.reminders ? `reminded ${s.reminders}× · ` : ''}next reminder in ${countdown(s.deadline, now)}`
  }
  return `Waiting · ${countdown(s.deadline, now)} left`
}

function LadderCard({ l, now, onAcknowledge }: { l: SilenceLadder; now: number; onAcknowledge: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = l.patient_name.split(' ')[0]
  const order: SilenceStep['kind'][] = l.contact_id ? ['tablet', 'contact', 'nurse'] : ['tablet', 'nurse']

  const acknowledge = async () => {
    setBusy(true)
    setError(null)
    try {
      await onAcknowledge()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article aria-label={`Inactivity check for ${l.patient_name}`}
             className={cn('flex flex-col gap-3 rounded-3xl border border-border border-l-4 bg-card p-5',
                           l.active ? 'border-l-caution' : 'opacity-75')}>
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm text-muted-foreground">{l.room}</span>
        <span className="text-lg font-bold">{l.patient_name}</span>
        <span role="status" className="text-sm font-semibold">
          {l.active ? `Now: ${STEP[l.current ?? 'tablet'].title}` : `Closed ${clock(l.closed_at as string)}`}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">started {timeAgo(l.started_at)}</span>
      </header>
      <p className="text-sm text-muted-foreground">{l.reason}</p>
      <p className="text-sm">Contacted so far: {l.steps.map((s) => who(l, s.kind).split(',')[0]).join(' · ')}</p>

      <ol className="flex flex-col gap-2">
        {order.map((kind) => {
          const s = l.steps.find((x) => x.kind === kind)
          const current = l.active && l.current === kind
          const Icon = STEP[kind].icon
          return (
            <li key={kind} className={cn('grid grid-cols-[1.25rem_1fr] gap-3',
                                         current && '-ml-3 border-l-4 border-primary pl-2',
                                         !s && 'text-muted-foreground')}>
              <Icon className="mt-0.5 size-5" aria-hidden="true" />
              <div>
                <p className={cn('font-semibold', !s && 'text-muted-foreground')}>
                  {STEP[kind].title} <span className="font-normal text-muted-foreground">· {who(l, kind)}</span>
                </p>
                <p className="text-sm tabular-nums">
                  {s ? status(l, s, now) : l.active ? 'Next, if there is no answer' : 'Not needed'}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      {l.active && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={acknowledge} disabled={busy}
                  className="min-tap inline-flex items-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground disabled:opacity-50">
            <Check className="size-5" aria-hidden="true" />
            I&apos;ve checked on {first} in person
          </button>
          <span className="text-sm text-muted-foreground">Closes every step. Nothing closes this check automatically.</span>
        </div>
      )}
      {error && <p className="text-sm text-urgent">{error}</p>}
    </article>
  )
}

/** Inactivity checks (silence detection, mode B): current step, countdown, who was contacted, acknowledge. */
export function SilencePanel() {
  const { ladders, patients, error, start, acknowledge } = useSilenceLadders()
  const [pick, setPick] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const active = ladders.filter((l) => l.active).sort((a, b) => b.started_at.localeCompare(a.started_at))
  const closed = ladders.filter((l) => !l.active)
    .sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? '')).slice(0, 3)

  useEffect(() => {   // plain-text countdown, once a second; nothing blinks
    if (active.length === 0) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active.length])

  const chosen = pick || patients[0]?.id || ''

  return (
    <section aria-labelledby="silence-h" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h2 id="silence-h" className="text-xl font-bold">Inactivity checks</h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <SyntheticTag>Synthetic demo patients</SyntheticTag>{active.length === 0 ? 'None running' : `${active.length} running`}
        </p>
      </header>

      {active.map((l) => <LadderCard key={l.id} l={l} now={now} onAcknowledge={() => acknowledge(l)} />)}
      {closed.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer font-semibold text-primary">Recently closed ({closed.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {closed.map((l) => <LadderCard key={l.id} l={l} now={now} onAcknowledge={() => acknowledge(l)} />)}
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          Start a check now
          <select value={chosen} onChange={(e) => setPick(e.target.value)}
                  className="h-11 rounded-xl border border-input bg-card px-3 text-base text-foreground">
            {patients.map((p) => <option key={p.id} value={p.id}>{p.room} · {p.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => start(chosen)} disabled={!chosen}
                className="h-11 rounded-xl border border-input bg-card px-4 text-base font-semibold hover:border-foreground disabled:opacity-50">
          Start
        </button>
      </div>
      {error && <p className="text-sm text-urgent">{error}</p>}
      <p className="text-xs text-muted-foreground">
        A check starts when a patient has been inactive for longer than usual for this time of day (never in quiet
        hours): tablet, then their trusted contact, then the nurse. It notices missing interaction only; it can&apos;t tell why.
      </p>
    </section>
  )
}
