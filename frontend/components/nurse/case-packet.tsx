'use client'

import { ArrowDown, ArrowUp, MessageSquareText } from 'lucide-react'
import { pct } from '@/lib/services/backend'
import type { Alert, CasePacket } from '@/lib/types'

const SBAR_ROWS = [
  ['situation', 'Situation'],
  ['background', 'Background'],
  ['assessment', 'Assessment'],
  ['recommendation', 'Next step'],
] as const

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Clinician copilot: what we know and don't, for a request that ended without a confident answer. */
export function CasePacketView({ alert }: { alert: Alert }) {
  const p = alert.case_packet as CasePacket
  const sbar = alert.case_sbar
  return (
    <section aria-label="Unclear request: case packet" className="flex flex-col gap-3 rounded-2xl border-2 border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <MessageSquareText className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold">Unclear request</h3>
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

      <p className="text-xs text-muted-foreground">
        {alert.case_sbar_source === 'gemini'
          ? 'Worded by Gemini from the case facts and checked against them.'
          : 'From the case facts (template).'}{' '}
        Communication steps only; not a diagnosis.
      </p>
    </section>
  )
}
