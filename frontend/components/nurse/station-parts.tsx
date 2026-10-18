'use client'

import { Check, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { needLabel } from '@/lib/live/catalog'
import { pct, timeAgo } from '@/lib/services/backend'
import type { Alert, NurseBoardRow, SilenceLadder } from '@/lib/types'
import { cn } from '@/lib/utils'

/** A panel that slides in from the right, for anything longer than a card (details, suggestions, summary). */
export function SideDrawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="top-0 right-0 left-auto flex h-dvh w-full max-w-2xl translate-x-0 translate-y-0 flex-col gap-4 overflow-y-auto rounded-none bg-background p-5 ring-0 border-l border-border shadow-2xl sm:max-w-2xl md:p-6">
        <DialogTitle className="pr-10 text-lg font-semibold tracking-tight">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const BAR = { urgent: 'border-l-urgent', routine: 'border-l-primary', checkin: 'border-l-caution' } as const
const TAG = {
  urgent: 'bg-urgent-soft text-urgent', routine: 'bg-primary-soft text-primary', checkin: 'bg-caution-soft text-caution',
} as const

function CardFrame({ kind, room, name, when, children }: {
  kind: keyof typeof BAR; room: string; name: string; when: string; children: React.ReactNode
}) {
  return (
    <article className={cn('panel flex flex-col gap-2.5 border-l-[3px] p-5', BAR[kind])}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide', TAG[kind])}>
          {kind === 'urgent' ? 'Urgent' : kind === 'checkin' ? 'Check-in' : 'Request'}
        </span>
        <span className="num text-sm text-muted-foreground">{room}</span>
        <span className="text-sm font-semibold">{name}</span>
        <span className="ml-auto text-sm text-muted-foreground">{timeAgo(when)}</span>
      </header>
      {children}
    </article>
  )
}

/** One open request: what they need, in a line, plus Confirm and Details. */
export function QueueAlert({ alert, onConfirm, onDetails }: {
  alert: Alert; onConfirm: (needId: string | null) => Promise<void>; onDetails: () => void
}) {
  const [busy, setBusy] = useState(false)
  const urgent = alert.priority === 'urgent'
  const [lead, next] = alert.top
  const headline = alert.label ?? lead?.label ?? 'Request'
  const confirm = async (needId: string | null) => {
    setBusy(true)
    try { await onConfirm(needId) } finally { setBusy(false) }
  }
  return (
    <CardFrame kind={urgent ? 'urgent' : 'routine'} room={alert.room} name={alert.patient_name} when={alert.created_at}>
      <p className={cn('text-lg font-semibold leading-snug tracking-tight', urgent && 'text-urgent')}>
        {headline}
        {!alert.label && lead && <span className="num ml-2 text-sm font-normal text-muted-foreground">{pct(lead.p)}</span>}
      </p>
      <p className="text-sm text-muted-foreground">
        {alert.choice ? <>Patient chose “{alert.choice.label}”</> : next ? <>Or maybe {next.label.toLowerCase()}</> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {alert.kind === 'need' ? (
          <select
            aria-label={`Confirm what ${alert.patient_name} needed`}
            value=""
            disabled={busy}
            onChange={(e) => (e.target.value === '__other' ? onDetails() : void confirm(e.target.value))}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <option value="" disabled>Confirm what they needed…</option>
            {alert.prediction_set.slice(0, 4).map((n) => <option key={n} value={n}>{needLabel(n)}</option>)}
            <option value="__other">Something else…</option>
          </select>
        ) : (
          <button type="button" disabled={busy} onClick={() => void confirm(null)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50">
            <Check className="size-5" aria-hidden="true" /> I&apos;m on it
          </button>
        )}
        <button type="button" onClick={onDetails}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted">
          Details <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </CardFrame>
  )
}

const STEP_NOW = {
  tablet: (l: SilenceLadder) => `The tablet asked ${l.patient_name.split(' ')[0]} “Are you okay?”`,
  contact: (l: SilenceLadder) => `Asking ${l.contact_name ?? 'their contact'} to check`,
  nurse: () => 'Waiting for a nurse',
} as const

/** A silence check-in still open: what's happening now, and the one action that closes it. */
export function QueueCheckIn({ ladder, onAcknowledge }: { ladder: SilenceLadder; onAcknowledge: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const first = ladder.patient_name.split(' ')[0]
  return (
    <CardFrame kind="checkin" room={ladder.room} name={ladder.patient_name} when={ladder.started_at}>
      <p className="text-lg font-semibold leading-snug tracking-tight">Hasn&apos;t tapped for longer than usual</p>
      <p className="text-sm text-muted-foreground">{STEP_NOW[ladder.current ?? 'tablet'](ladder)}</p>
      <div>
        <button type="button" disabled={busy}
                onClick={async () => { setBusy(true); try { await onAcknowledge() } finally { setBusy(false) } }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50">
          <Check className="size-5" aria-hidden="true" /> I&apos;ve checked on {first}
        </button>
      </div>
    </CardFrame>
  )
}

const DOT: Record<NurseBoardRow['state'], string> = {
  urgent: 'bg-urgent', checkin: 'bg-caution', waiting: 'bg-primary', answering: 'bg-primary/60',
  consult: 'bg-primary/60', calm: 'bg-muted-foreground/30',
}

/** "Unit right now": one line per patient, most pressing first. */
export function UnitBoard({ rows, onPick }: { rows: NurseBoardRow[]; onPick: (r: NurseBoardRow) => void }) {
  return (
    <ul className="panel flex flex-col divide-y divide-border overflow-hidden">
      {rows.map((r) => (
        <li key={r.patient_id}>
          <button type="button" onClick={() => onPick(r)}
                  className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-muted/60">
            <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[r.state])} aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="num text-xs text-muted-foreground">{r.room}</span>
              </span>
              <span className={cn('text-sm', r.state === 'urgent' ? 'font-semibold text-urgent' : 'text-muted-foreground')}>
                {r.headline}{r.since && ` · ${timeAgo(r.since)}`}
              </span>
              {r.screen && <span className="text-xs text-muted-foreground">Tablet showing: {r.screen}</span>}
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}
