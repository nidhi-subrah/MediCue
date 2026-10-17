'use client'

import {
  ArrowDown, ArrowUp, BatteryLow, Check, CircleCheck, CircleDashed, Clock, Copy, Eye, FileText, Gauge, Hand,
  Hourglass, ListChecks, MessageCircleQuestion, MessageSquare, Scale, ShieldAlert,
  TimerOff, Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api, pct } from '@/lib/services/backend'
import type { Alert, CaseFeedback, CaseRecord, NextStepCode, StopReason } from '@/lib/types'
import { cn } from '@/lib/utils'

const NURSE = 'Nurse station'

// Every state gets an icon AND a word; colour never carries meaning on its own.
const STOP: Record<StopReason, { icon: typeof Clock; title: string }> = {
  RESOLVED: { icon: CircleCheck, title: 'Clear enough to send' },
  SAFETY_FLOOR: { icon: ShieldAlert, title: 'High-risk need possible' },
  FATIGUE_HIGH: { icon: BatteryLow, title: 'Patient tiring' },
  INFO_GAIN_BELOW_COST: { icon: Scale, title: 'No question worth the effort' },
  PATIENT_TIMEOUT: { icon: TimerOff, title: 'Patient stopped responding' },
  MAX_QUESTIONS: { icon: ListChecks, title: 'Question limit reached' },
  CONSULT_PENDING: { icon: Hourglass, title: 'Waiting on a trusted contact' },
}
const NEXT: Record<NextStepCode, typeof Clock> = {
  ASK_YES_NO: MessageCircleQuestion,
  SHOW_PAIN_SCALE: Gauge,
  ASK_CONTACT: Users,
  RECHECK_LATER: Clock,
  WATCH_FOR_GESTURES: Eye,
}
const CAUSE_WORD = { tap: 'Tap', answer: 'Answer', consult: 'Contact said', chart: 'Chart' } as const

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export function sbarText(alert: Alert, record: CaseRecord) {
  const s = record.sbar
  return [
    `SBAR: ${alert.patient_name} (room ${alert.room})`,
    `S: ${s.situation}`, `B: ${s.background}`, `A: ${s.assessment}`, `R: ${s.recommendation}`,
    `Generated from structured data${record.sbar_source === 'template' ? ' (template version)' : ' (worded by Gemini, checked)'}.`,
  ].join('\n')
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {   // clipboard API blocked (e.g. no HTTPS): fall back to a hidden textarea
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

// ---- sections ------------------------------------------------------------------------------------

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`case-s${n}`} className="flex flex-col gap-3 border-t-2 border-border pt-4">
      <h3 id={`case-s${n}`} className="text-xl font-bold">{title}</h3>
      {children}
    </section>
  )
}

function Selections({ record }: { record: CaseRecord }) {
  const items = record.packet.selections
  if (items.length === 0) return <p className="text-lg text-muted-foreground">No taps or answers.</p>
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="In order">
      {items.map((s, i) => {
        const answer = s.kind === 'answer'
        const [question, reply] = answer ? s.text.split(' → ') : [null, null]
        const Icon = answer ? MessageSquare : Hand
        return (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-xl text-muted-foreground">→</span>}
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-foreground/70 bg-card px-3 py-1.5 text-lg">
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap font-mono text-base text-muted-foreground">{clock(s.t)}</span>
              {answer
                ? <span>{question} <strong>{reply}</strong></span>
                : <strong>{s.text.split(': ').slice(1).join(': ')}</strong>}
              <span className="sr-only">{answer ? '(answer)' : s.kind === 'tap_area' ? '(body area)' : '(feeling)'}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Likely({ record }: { record: CaseRecord }) {
  return (
    <ul className="flex flex-col gap-3">
      {record.packet.top_needs.map((n) => (
        <li key={n.need} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-lg font-semibold">{n.label}</span>
            <span className="font-mono text-2xl font-bold tabular-nums">{pct(n.p)}</span>
          </div>
          <div className="h-4 w-full rounded-full border-2 border-foreground/60 bg-card" aria-hidden="true">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(n.p * 100, 2)}%` }} />
          </div>
          <span className="inline-flex items-center gap-1.5 text-base text-muted-foreground">
            {n.in_set
              ? <><CircleCheck className="size-4" aria-hidden="true" />In the 90% set</>
              : <><CircleDashed className="size-4" aria-hidden="true" />Outside the 90% set</>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function LessLikely({ record }: { record: CaseRecord }) {
  const items = record.packet.less_likely
  if (record.packet.variant === 'light') {
    return <p className="text-lg text-muted-foreground">Left out of the quick packet for a high-risk escalation.</p>
  }
  if (items.length === 0) return <p className="text-lg text-muted-foreground">No need dropped noticeably.</p>
  return (
    <details className="text-lg">
      <summary className="w-fit cursor-pointer font-semibold text-primary">
        Show {items.length} need{items.length === 1 ? '' : 's'} that became less likely
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((x) => (
          <li key={x.need} className="rounded-xl border-2 border-border bg-card px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{x.label}</span>
              <span className="inline-flex items-center gap-1 font-mono">
                <ArrowDown className="size-4" aria-hidden="true" />{pct(x.from_p)} → {pct(x.to_p)}
                <span className="sr-only">lowered</span>
              </span>
            </div>
            <p className="text-base text-muted-foreground">{CAUSE_WORD[x.cause.kind]}: {x.cause.text.replace(/^Chart: /, '')}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-base text-muted-foreground">Less likely, not ruled out: the system cannot rule a need out.</p>
    </details>
  )
}

function Chart({ record }: { record: CaseRecord }) {
  const items = record.packet.chart_context
  if (record.packet.variant === 'light') {
    return <p className="text-lg text-muted-foreground">Left out of the quick packet for a high-risk escalation.</p>
  }
  if (items.length === 0) return <p className="text-lg text-muted-foreground">No chart field changed the picture.</p>
  return (
    <ul className="flex flex-col gap-2 text-lg">
      {items.map((c) => {
        const up = c.direction === 'up'
        const Icon = up ? ArrowUp : ArrowDown
        return (
          <li key={c.lookup} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
            <Icon className="mt-1 size-5" aria-hidden="true" />
            <div>
              <p>
                <strong>{up ? 'Raised' : 'Lowered'}</strong> {c.need_label}{' '}
                <span className="whitespace-nowrap font-mono">{pct(c.from_p)} → {pct(c.to_p)}</span>
              </p>
              <p className="text-base text-muted-foreground">{c.label}{c.value ? `: ${c.value}` : ''}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function WhyStopped({ record }: { record: CaseRecord }) {
  const { icon: Icon, title } = STOP[record.packet.stop_reason.code]
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-7 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-lg">{record.packet.stop_reason.text}</p>
        <p className="text-base text-muted-foreground">{record.packet.uncertainty.text}</p>
      </div>
    </div>
  )
}

function NextStep({ record }: { record: CaseRecord }) {
  const Icon = NEXT[record.packet.next_step.code]
  return (
    <div className="flex items-start gap-3 rounded-2xl border-4 border-primary bg-primary-soft p-4">
      <Icon className="mt-1 size-8 shrink-0 text-primary" aria-hidden="true" />
      <p className="text-2xl font-bold leading-snug">{record.packet.next_step.text}</p>
    </div>
  )
}

const SBAR_ROWS = [['situation', 'S'], ['background', 'B'], ['assessment', 'A'], ['recommendation', 'R']] as const

const GEMINI_STATUS: Record<CaseRecord['gemini']['outcome'], string> = {
  gemini: 'Gemini reworded the same facts. Every number, need and chart field was checked against the packet, '
    + 'and the recommendation is the next step word for word.',
  disabled: 'Gemini is off on this server (no API key), so there is no Gemini version: nurses see the template.',
  pending: 'Gemini is writing its version…',
  no_reply: 'Gemini did not reply (quota, timeout or error), so the template is shown to nurses.',
  rejected: 'Gemini’s wording failed the checks, so the template is shown to nurses.',
}

/** The same packet as an SBAR: the template (Gemini off) or Gemini's wording (Gemini on). */
function SbarCompare({ record }: { record: CaseRecord }) {
  const [view, setView] = useState<'template' | 'gemini'>(record.sbar_source === 'gemini' ? 'gemini' : 'template')
  const [asking, setAsking] = useState(false)
  const g = record.gemini
  const shown = view === 'template' ? record.sbar_template : g.sbar
  const option = (value: 'template' | 'gemini', label: string) => (
    <button type="button" aria-pressed={view === value} onClick={() => setView(value)}
            className={cn('h-11 rounded-xl border-2 px-4 text-base font-semibold',
                          view === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>
      {label}
    </button>
  )
  const askAgain = async () => {
    setAsking(true)
    try {
      await api.post(`/api/cases/${record.id}/gemini`)   // the `case` push updates the card
    } finally {
      setAsking(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="SBAR version">
        {option('template', 'Gemini off: template')}
        {option('gemini', 'Gemini on')}
        <span className="text-base text-muted-foreground">
          Nurses currently see: <strong className="text-foreground">{record.sbar_source === 'gemini' ? 'Gemini' : 'template'}</strong>
        </span>
      </div>
      {view === 'gemini' && (
        <div className="flex flex-col gap-1 text-base">
          <p>{GEMINI_STATUS[g.outcome]}</p>
          {g.outcome === 'rejected' && g.problems.length > 0 && (
            <ul className="list-disc pl-6 text-muted-foreground">{g.problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          {(g.outcome === 'no_reply' || g.outcome === 'rejected') && (
            <button type="button" onClick={askAgain} disabled={asking}
                    className="self-start rounded-xl border-2 border-border bg-card px-3 py-1.5 text-base font-semibold disabled:opacity-50">
              {asking ? 'Asking…' : 'Ask Gemini again'}
            </button>
          )}
        </div>
      )}
      {shown && (
        <dl className="grid gap-2 rounded-2xl border-2 border-border bg-card p-4">
          {SBAR_ROWS.map(([k, letter]) => (
            <div key={k} className="grid grid-cols-[2rem_1fr] gap-2">
              <dt className="font-mono text-lg font-bold">{letter}</dt>
              <dd className="text-lg leading-relaxed">{shown[k]}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="text-base">
        <summary className="w-fit cursor-pointer font-semibold text-primary">What Gemini is sent</summary>
        <p className="mt-2 text-muted-foreground">
          Only these structured facts. Gemini rewords them; it never chooses the needs, the stop reason or the next step.
        </p>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl border-2 border-border bg-surface p-3 font-mono text-sm leading-snug whitespace-pre-wrap">
          {JSON.stringify(record.facts, null, 2)}
        </pre>
      </details>
    </div>
  )
}

// ---- the card ------------------------------------------------------------------------------------

export function CasePacketCard({ alert }: { alert: Alert }) {
  const record = alert.case as CaseRecord
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const light = record.packet.variant === 'light'

  const onCopy = async () => setCopied((await copy(sbarText(alert, record))) ? 'copied' : 'failed')
  const onAcknowledge = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/cases/${record.id}/acknowledge`, { nurse: NURSE })   // the `case` push updates the card
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="flex flex-col gap-5 text-foreground">
      <header className="flex flex-col gap-1 pr-10">
        <p className="font-mono text-base text-muted-foreground">{alert.room} · {light ? 'Quick packet (high-risk)' : 'Case packet'}</p>
        <DialogTitle className="text-3xl font-bold leading-tight">{alert.patient_name}</DialogTitle>
        <DialogDescription className="text-lg text-muted-foreground">
          What the system knows, and doesn&apos;t, about this request.
        </DialogDescription>
      </header>

      <Section n={1} title="What the patient selected"><Selections record={record} /></Section>
      <Section n={2} title="Most likely needs"><Likely record={record} /></Section>
      <Section n={3} title="Less likely given answers"><LessLikely record={record} /></Section>
      <Section n={4} title="Chart context that mattered"><Chart record={record} /></Section>
      <Section n={5} title="Why we stopped asking"><WhyStopped record={record} /></Section>
      <Section n={6} title="Suggested next communication step"><NextStep record={record} /></Section>
      <Section n={7} title="SBAR handoff"><SbarCompare record={record} /></Section>

      <footer className="flex flex-col gap-3 border-t-2 border-border pt-4">
        <div className="flex flex-wrap items-center gap-2 text-base text-muted-foreground">
          <FileText className="size-5" aria-hidden="true" />
          Generated from structured data
          {record.sbar_source === 'template'
            ? <span className="rounded-md border-2 border-foreground/60 px-2 font-mono text-sm font-semibold uppercase tracking-wide text-foreground">Template version</span>
            : <span>· worded by Gemini and checked against the data</span>}
          <span>· communication steps only, not a diagnosis</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onCopy}
                  className="min-tap inline-flex items-center gap-2 rounded-xl border-2 border-foreground/70 bg-card px-5 text-lg font-semibold">
            {copied === 'copied' ? <Check className="size-5" aria-hidden="true" /> : <Copy className="size-5" aria-hidden="true" />}
            {copied === 'copied' ? 'SBAR copied' : 'Copy SBAR'}
          </button>
          {record.acknowledged ? (
            <p className="inline-flex items-center gap-2 text-lg font-semibold">
              <Check className="size-5" aria-hidden="true" />
              Acknowledged by {record.acknowledged.by} at {clock(record.acknowledged.at)}
            </p>
          ) : (
            <button type="button" onClick={onAcknowledge} disabled={busy}
                    className="min-tap inline-flex items-center gap-2 rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground disabled:opacity-50">
              <Check className="size-5" aria-hidden="true" />Acknowledge
            </button>
          )}
          <DialogClose className="min-tap ml-auto rounded-xl border-2 border-border bg-card px-5 text-lg font-semibold">
            Close
          </DialogClose>
          <span role="status" className="sr-only">{copied === 'copied' ? 'SBAR copied to the clipboard' : ''}</span>
        </div>
        {copied === 'failed' && (
          <label className="flex flex-col gap-1.5 text-base">
            <span className="font-semibold">This browser blocked copying. Select the text and copy it yourself:</span>
            <textarea readOnly rows={6} value={sbarText(alert, record)} onFocus={(e) => e.currentTarget.select()} autoFocus
                      className="rounded-xl border-2 border-foreground/60 bg-card p-3 font-mono text-sm" />
          </label>
        )}
        <p className="text-base text-muted-foreground">
          Acknowledge means you have read this and are acting on it. Confirm what they needed on the alert afterwards.
        </p>
        {error && <p className="text-base text-urgent">{error}</p>}
      </footer>
    </article>
  )
}

// ---- on the alert card -----------------------------------------------------------------------------

function FeedbackLine({ fb }: { fb: CaseFeedback }) {
  const where = fb.actual_rank ? `#${fb.actual_rank} in the packet`
    : fb.actual_was_less_likely ? 'listed as less likely' : 'not in the packet'
  return (
    <p className="text-sm">
      Confirmed by {fb.by}
      {fb.actual_label && <> · they needed <strong>{fb.actual_label}</strong> ({where})</>}
    </p>
  )
}

/** Compact summary on the alert card; the full Case packet card opens from it. */
export function CaseSummary({ alert, initiallyOpen = false }: { alert: Alert; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  // The demo's alert can reach the screen before the demo request returns, so open on the change too.
  useEffect(() => {
    if (initiallyOpen) setOpen(true)
  }, [initiallyOpen])
  const record = alert.case as CaseRecord
  const light = record.packet.variant === 'light'
  const Icon = NEXT[record.packet.next_step.code]
  return (
    <section aria-label="Case packet" className="flex flex-col gap-3 rounded-2xl border-2 border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-muted-foreground">
            {light ? 'High-risk: what to ask first' : 'Unclear request'}
            {record.acknowledged && ` · acknowledged by ${record.acknowledged.by}`}
          </p>
          <p className="flex items-start gap-2 text-lg font-semibold">
            <Icon className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />{record.packet.next_step.text}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)}
                className="h-11 shrink-0 rounded-xl border-2 border-primary bg-card px-4 text-base font-semibold text-primary">
          Open case packet
        </button>
      </div>
      {record.feedback && <FeedbackLine fb={record.feedback} />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[92dvh] overflow-y-auto bg-card p-6 sm:max-w-3xl md:p-8 data-open:animate-none data-closed:animate-none">
          <CasePacketCard alert={alert} />
        </DialogContent>
      </Dialog>
    </section>
  )
}
