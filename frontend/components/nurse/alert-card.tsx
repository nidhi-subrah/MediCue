'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ProfileList } from '@/components/profile/profile-list'
import { BeliefBars } from '@/components/talk/belief-bars'
import { catalog, needLabel } from '@/lib/live/catalog'
import { pct, timeAgo } from '@/lib/services/backend'
import type { Alert } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CaseSummary } from './case-packet'

const SBAR_ROWS = [
  ['situation', 'Situation'],
  ['background', 'Background'],
  ['assessment', 'Assessment'],
  ['recommendation', 'Recommendation'],
] as const

export function AlertCard({
  alert,
  onConfirm,
  openCase = false,
}: {
  alert: Alert
  onConfirm: (needId: string | null, note: string | null, caseHelpful: boolean | null) => Promise<void>
  openCase?: boolean                  // open the case packet card as soon as it arrives (demo)
}) {
  const [other, setOther] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [helpful, setHelpful] = useState<boolean | null>(null)   // verdict on the case packet, sent with the confirmation
  const urgent = alert.priority === 'urgent'
  const open = alert.status === 'open'
  const [lead, ...rest] = alert.top

  const confirm = async (needId: string | null) => {
    setBusy(true)
    try {
      await onConfirm(needId, note.trim() || null, helpful)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      aria-label={`${urgent ? 'Urgent' : 'Routine'} alert for ${alert.patient_name}`}
      className={cn(
        'flex flex-col gap-3 rounded-3xl border-2 p-5 md:p-6',
        urgent ? 'border-urgent bg-urgent-soft' : 'border-border bg-card',
        !open && 'opacity-60',
      )}
    >
      <header className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-sm font-medium text-muted-foreground">{alert.room}</span>
        <span className="text-lg font-bold">{alert.patient_name}</span>
        <span className={cn('text-sm font-semibold', urgent ? 'text-urgent' : 'text-muted-foreground')}>
          {urgent ? 'Urgent' : 'Routine'}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">
          {timeAgo(alert.created_at)} · alert in {alert.seconds_to_alert}s
        </span>
      </header>

      {alert.label && <p className="text-base font-semibold">{alert.label}</p>}

      {alert.choice && (
        <p className="text-sm text-muted-foreground">
          Patient chose <span className="font-semibold text-foreground">“{alert.choice.label}”</span>
          {alert.choice.predicted
            ? ` · a suggested option (ranked by ${alert.choice.source === 'gemini' ? 'Gemini' : 'the engine'})`
            : ' · from “Something else”'}
        </p>
      )}

      {alert.kind === 'need' && lead && (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={cn('text-2xl font-bold tracking-tight', urgent && 'text-urgent')}>{lead.label}</span>
          <span className="font-mono text-lg">{pct(lead.p)}</span>
          {rest.length > 0 && (
            <span className="text-sm text-muted-foreground">
              or {rest.slice(0, 2).map((t) => `${t.label.toLowerCase()} ${pct(t.p)}`).join(', ')}
            </span>
          )}
        </div>
      )}

      {alert.case && <CaseSummary alert={alert} helpful={helpful} onHelpful={setHelpful} initiallyOpen={openCase} />}

      <dl className="grid gap-1.5">
        {SBAR_ROWS.map(([k, label]) => (
          <div key={k} className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
            <dt className="pt-0.5 text-sm text-muted-foreground">{label}</dt>
            <dd className="text-base">{alert.sbar[k]}</dd>
          </div>
        ))}
      </dl>

      {alert.communication && (
        // Assisted communication: the patient couldn't finish. What they did say, and what is still open.
        <div className="grid gap-3 rounded-2xl border border-primary/30 bg-primary-soft p-4 text-sm sm:grid-cols-3">
          <p className="sm:col-span-3 font-semibold">{alert.reason}</p>
          <div>
            <p className="font-semibold">Confirmed</p>
            {alert.communication.confirmed.length
              ? alert.communication.confirmed.map((c) => <p key={c.field}>{c.field}: {c.value}</p>)
              : <p className="text-muted-foreground">Nothing yet</p>}
          </div>
          <div>
            <p className="font-semibold">Unresolved</p>
            {alert.communication.unresolved.map((u) => <p key={u.field}>{u.field}</p>)}
          </div>
          <div>
            <p className="font-semibold">Current belief</p>
            {alert.communication.belief.map((b) => <p key={b.label}>{b.label}: {pct(b.p)}</p>)}
          </div>
        </div>
      )}

      {alert.kind === 'need' && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-primary">How it got here · {pct(alert.p_high)} high-risk</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-muted-foreground">{alert.reason}</p>
            <div className="max-w-md">
              <BeliefBars items={alert.top} set={alert.prediction_set} />
            </div>
            {alert.asked.length > 0 && (
              <ul className="list-disc pl-5">
                {alert.asked.map((a, i) => (
                  <li key={i}>Asked &ldquo;{a.question}&rdquo;: <strong>{a.answer}</strong></li>
                ))}
              </ul>
            )}
            {alert.consults.length > 0 && (
              <ul className="list-disc pl-5">
                {alert.consults.map((c, i) => (
                  <li key={i}>{c.person} said: <strong>{c.answer}</strong></li>
                ))}
              </ul>
            )}
            {alert.lookups.length > 0 && (
              <ul className="list-disc pl-5">
                {alert.lookups.map((l, i) => (
                  <li key={i} className={l.flag ? 'font-semibold' : ''}>{l.label}: {l.value}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Summary {alert.sbar_source === 'gemini' ? "written by Gemini from the engine's data" : 'from template (Gemini off)'}
            </p>
          </div>
        </details>
      )}

      {alert.profile?.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-primary">
            Patient profile · {alert.profile.length} item{alert.profile.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <ProfileList items={alert.profile} />
            <Link href={`/profile/${alert.patient_id}`} className="w-fit font-semibold text-primary underline-offset-4 hover:underline">
              Notes and profile
            </Link>
          </div>
        </details>
      )}

      {open && alert.kind === 'need' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            Observation (optional). Gemini suggests profile updates from it for a nurse to approve.
          </span>
          <textarea
            rows={2}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Took ages on the second question. Easier to ask his daughter after 8pm."
            className="rounded-xl border-2 border-input bg-background p-3 text-base"
          />
        </label>
      )}

      {open ? (
        alert.kind === 'need' ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Confirm what the patient needed">
            <span className="mr-1 text-sm text-muted-foreground">They needed</span>
            {alert.prediction_set.slice(0, 4).map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => confirm(n)}
                className="min-tap inline-flex items-center rounded-xl border-2 border-border bg-card px-4 text-base font-semibold hover:border-primary disabled:opacity-40"
              >
                {needLabel(n)}
              </button>
            ))}
            <select
              value={other}
              disabled={busy}
              aria-label="Something else"
              onChange={(e) => {
                setOther(e.target.value)
                if (e.target.value) confirm(e.target.value)
              }}
              className="h-11 rounded-xl border-2 border-input bg-background px-3 text-base"
            >
              <option value="">Something else…</option>
              {catalog.needs.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm(null)}
            className="min-tap inline-flex items-center self-start rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Acknowledge
          </button>
        )
      ) : (
        <>
          <p className="text-base font-semibold text-success">
            Confirmed{alert.confirmed_need ? `: ${needLabel(alert.confirmed_need)}` : ''}
          </p>
          {alert.nurse_note && <p className="text-sm text-muted-foreground">Note: {alert.nurse_note}</p>}
        </>
      )}
    </article>
  )
}
