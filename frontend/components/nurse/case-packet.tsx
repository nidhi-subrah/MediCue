'use client'

import { ArrowDown, ArrowUp, MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react'
import { pct } from '@/lib/services/backend'
import type { Alert, CaseFeedback, CaseRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

const SBAR_ROWS = [
  ['situation', 'Situation'],
  ['background', 'Background'],
  ['assessment', 'Assessment'],
  ['recommendation', 'Next step'],
] as const

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function Verdict({ helpful, onHelpful }: { helpful: boolean | null; onHelpful: (v: boolean | null) => void }) {
  const option = (value: boolean, label: string, Icon: typeof ThumbsUp) => (
    <button type="button" aria-pressed={helpful === value} onClick={() => onHelpful(helpful === value ? null : value)}
            className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border-2 px-3 text-sm font-semibold',
                          helpful === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>
      <Icon className="size-4" aria-hidden="true" />{label}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Was this packet helpful?</span>
      {option(true, 'Helpful', ThumbsUp)}
      {option(false, 'Not helpful', ThumbsDown)}
      <span className="text-sm text-muted-foreground">Then tap what they needed below.</span>
    </div>
  )
}

function FeedbackLine({ fb }: { fb: CaseFeedback }) {
  const verdict = fb.helpful === null ? 'No verdict' : fb.helpful ? 'Marked helpful' : 'Marked not helpful'
  const where = fb.actual_rank ? `#${fb.actual_rank} in the packet`
    : fb.actual_was_less_likely ? 'listed as less likely' : 'not in the packet'
  return (
    <p className="text-sm">
      <strong>{verdict}</strong> by {fb.by}
      {fb.actual_label && <> · They needed {fb.actual_label} ({where})</>}
    </p>
  )
}

/** Clinician copilot: what we know and don't, for a request that ended without a confident answer
 *  (full packet) or a high-risk escalation (light packet). */
export function CasePacketView({ alert, helpful, onHelpful }: {
  alert: Alert; helpful: boolean | null; onHelpful: (v: boolean | null) => void
}) {
  const record = alert.case as CaseRecord
  const p = record.packet
  const sbar = record.sbar
  const light = p.variant === 'light'
  return (
    <section aria-label={light ? 'High-risk request: quick packet' : 'Unclear request: case packet'}
             className="flex flex-col gap-3 rounded-2xl border-2 border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <MessageSquareText className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold">{light ? 'High-risk: what to ask first' : 'Unclear request'}</h3>
        <span className="text-sm text-muted-foreground">
          {p.uncertainty.set_size} needs possible · top {pct(p.uncertainty.top_p)}
        </span>
      </header>

      <p className="rounded-xl border-l-4 border-primary bg-card px-3 py-2 text-base font-semibold">
        Next step: {p.next_step.text}
      </p>

      {sbar && (
        <dl className="grid gap-1.5">
          {SBAR_ROWS.filter(([k]) => k === 'situation' || k === 'assessment').map(([k, label]) => (
            <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-3">
              <dt className="pt-0.5 text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm">{sbar[k]}</dd>
            </div>
          ))}
        </dl>
      )}

      <details className="text-sm">
        <summary className="w-fit cursor-pointer font-semibold text-primary">The details</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {sbar && (
            <div className="sm:col-span-2">
              <h4 className="font-semibold">Background</h4>
              <p className="text-muted-foreground">{sbar.background}</p>
            </div>
          )}
          <div>
            <h4 className="font-semibold">Why it stopped asking</h4>
            <p className="text-muted-foreground">{p.stop_reason.text}</p>
          </div>
          <div>
            <h4 className="font-semibold">What the patient did</h4>
            <ol className="text-muted-foreground">
              {p.selections.map((s, i) => <li key={i}><span className="font-mono">{clock(s.t)}</span> {s.text}</li>)}
            </ol>
          </div>
          <div>
            <h4 className="font-semibold">Most likely</h4>
            <ul>
              {p.top_needs.map((n) => (
                <li key={n.need}>
                  {n.label} <span className="font-mono">{pct(n.p)}</span>
                  {!n.in_set && <span className="text-muted-foreground"> · outside the 90% set</span>}
                </li>
              ))}
            </ul>
          </div>
          {p.less_likely.length > 0 && (
            <div>
              <h4 className="font-semibold">Less likely given answers</h4>
              <ul>
                {p.less_likely.map((x) => (
                  <li key={x.need}>
                    {x.label} <span className="font-mono">{pct(x.from_p)} → {pct(x.to_p)}</span>
                    <span className="text-muted-foreground"> after {x.cause.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.chart_context.length > 0 && (
            <div className="sm:col-span-2">
              <h4 className="font-semibold">Chart fields that changed the picture</h4>
              <ul>
                {p.chart_context.map((c) => (
                  <li key={c.lookup} className="flex flex-wrap items-center gap-1">
                    {c.direction === 'up'
                      ? <ArrowUp className="size-4" aria-label="raised" />
                      : <ArrowDown className="size-4" aria-label="lowered" />}
                    {c.label}{c.value ? ` (${c.value})` : ''}: {c.need_label}{' '}
                    <span className="font-mono">{pct(c.from_p)} → {pct(c.to_p)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>

      {record.feedback ? <FeedbackLine fb={record.feedback} />
        : alert.status === 'open' && <Verdict helpful={helpful} onHelpful={onHelpful} />}

      <p className="text-xs text-muted-foreground">
        {record.sbar_source === 'gemini'
          ? 'Worded by Gemini from the case facts and checked against them.'
          : 'From the case facts (template).'}{' '}
        Communication steps only; not a diagnosis.
      </p>
    </section>
  )
}
