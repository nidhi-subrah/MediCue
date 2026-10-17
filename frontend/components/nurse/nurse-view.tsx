'use client'

import { ChartColumn, ClipboardList, FlaskConical, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { needLabel } from '@/lib/live/catalog'
import { useNurseStation } from '@/lib/live/nurse'
import { useNurseBoard } from '@/lib/live/nurse-views'
import { useSilenceLadders } from '@/lib/live/risk'
import type { NurseBoardRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AlertCard } from './alert-card'
import { DemoScenarioBar } from './demo-scenario'
import { ShiftSummary } from './shift-summary'
import { QueueAlert, QueueCheckIn, SideDrawer, UnitBoard } from './station-parts'
import { SuggestionsPanel } from './suggestions-panel'

type Drawer = { kind: 'alert'; id: string; openCase?: boolean } | { kind: 'patient'; row: NurseBoardRow }
  | { kind: 'suggestions' } | { kind: 'summary' } | null

const smallButton = 'inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-muted'

/** The nurse station: what needs a nurse right now, and where every patient is right now. Trends live in Unit
 *  insights, predictions in Care forecast, handover in the Shift summary. */
export function NurseView() {
  const { alerts, suggestions, confirm, reviewSuggestion } = useNurseStation()
  const { ladders, start, acknowledge } = useSilenceLadders()
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [demoAlert, setDemoAlert] = useState<string | null>(null)   // the demo's alert opens with its case packet
  const [showDone, setShowDone] = useState(false)

  const open = alerts.filter((a) => a.status === 'open')
    .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || b.created_at.localeCompare(a.created_at))
  const urgent = open.filter((a) => a.priority === 'urgent')
  const routine = open.filter((a) => a.priority !== 'urgent')
  const checkins = ladders.filter((l) => l.active)
  const pending = suggestions.filter((s) => s.status === 'pending')
  const today = new Date().toDateString()
  const done = alerts.filter((a) => a.status !== 'open' && new Date(a.created_at).toDateString() === today)
  const board = useNurseBoard(useMemo(() => [open.length, checkins.length, alerts.length].join(), [open.length, checkins.length, alerts.length]))

  useEffect(() => {
    if (demoAlert && alerts.some((a) => a.id === demoAlert)) {
      setDrawer({ kind: 'alert', id: demoAlert, openCase: true })
      setDemoAlert(null)
    }
  }, [demoAlert, alerts])

  const drawerAlert = drawer?.kind === 'alert' ? alerts.find((a) => a.id === drawer.id) : undefined
  const counters = [
    { n: urgent.length, label: 'Urgent', tone: urgent.length ? 'border-urgent bg-urgent-soft text-urgent' : '' },
    { n: routine.length, label: 'Waiting', tone: routine.length ? 'border-primary/40 bg-primary-soft text-primary' : '' },
    { n: checkins.length, label: 'Check-ins', tone: checkins.length ? 'border-caution/50 bg-caution-soft text-caution' : '' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Nurse station</h1>
        <nav aria-label="Nurse tools" className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} onClick={() => setDrawer({ kind: 'summary' })}>
            <ClipboardList className="size-4" aria-hidden="true" /> Shift summary
          </button>
          <Link href="/nurse/insights" className={smallButton}><ChartColumn className="size-4" aria-hidden="true" /> Insights</Link>
          <Link href="/nurse/forecast" className={smallButton}><TrendingUp className="size-4" aria-hidden="true" /> Forecast</Link>
          <details className="relative">
            <summary className={cn(smallButton, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
              <FlaskConical className="size-4" aria-hidden="true" /> Demo
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-[min(32rem,90vw)] rounded-2xl border border-border bg-card p-4 shadow-lg">
              <DemoScenarioBar onAlert={setDemoAlert} />
            </div>
          </details>
        </nav>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counters.map((c) => (
          <div key={c.label} className={cn('flex flex-col rounded-2xl border border-border bg-card px-4 py-3', c.tone)}>
            <span className="text-3xl font-bold tabular-nums">{c.n}</span>
            <span className="text-sm font-semibold">{c.label}</span>
          </div>
        ))}
        <button type="button" onClick={() => setDrawer({ kind: 'suggestions' })} disabled={!suggestions.length}
                className={cn('flex flex-col rounded-2xl border border-border bg-card px-4 py-3 text-left hover:border-primary/40 disabled:hover:border-border',
                              pending.length && 'border-primary/40')}>
          <span className="text-3xl font-bold tabular-nums">{pending.length}</span>
          <span className="text-sm font-semibold">To review{pending.length > 0 && ' ›'}</span>
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="queue-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="queue-h" className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Needs you now</h2>
          {urgent.map((a) => <QueueAlert key={a.id} alert={a} onConfirm={(n) => confirm(a.id, n, null, null)}
                                         onDetails={() => setDrawer({ kind: 'alert', id: a.id })} />)}
          {checkins.map((l) => <QueueCheckIn key={l.id} ladder={l} onAcknowledge={() => acknowledge(l)} />)}
          {routine.map((a) => <QueueAlert key={a.id} alert={a} onConfirm={(n) => confirm(a.id, n, null, null)}
                                          onDetails={() => setDrawer({ kind: 'alert', id: a.id })} />)}
          {!open.length && !checkins.length && (
            <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-lg text-muted-foreground">
              Nothing needs you right now. Requests from bedside tablets appear here as they come in.
            </p>
          )}
          {done.length > 0 && (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setShowDone((v) => !v)}
                      className="self-start text-base font-semibold text-primary underline-offset-4 hover:underline">
                {showDone ? 'Hide' : 'Done today'} ({done.length})
              </button>
              {showDone && (
                <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card text-sm">
                  {done.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setDrawer({ kind: 'alert', id: a.id })}
                              className="flex w-full flex-wrap items-baseline gap-2 px-4 py-2.5 text-left hover:bg-muted/60">
                        <span className="font-mono text-muted-foreground">
                          {new Date(a.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                        <span className="font-semibold">{a.patient_name}</span>
                        <span className="text-muted-foreground">
                          {a.confirmed_need ? needLabel(a.confirmed_need) : a.label ?? 'Acknowledged'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="unit-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="unit-h" className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Unit right now</h2>
          <UnitBoard rows={board} onPick={(row) => setDrawer({ kind: 'patient', row })} />
        </section>
      </div>

      <SideDrawer open={!!drawerAlert} onClose={() => setDrawer(null)}
                  title={drawerAlert ? `${drawerAlert.patient_name} · ${drawerAlert.room}` : ''}>
        {drawerAlert && (
          <AlertCard alert={drawerAlert} openCase={drawer?.kind === 'alert' && !!drawer.openCase}
                     onConfirm={async (needId, note) => { await confirm(drawerAlert.id, needId, note, null); setDrawer(null) }} />
        )}
      </SideDrawer>

      <SideDrawer open={drawer?.kind === 'suggestions'} onClose={() => setDrawer(null)} title="Profile suggestions">
        <SuggestionsPanel items={suggestions} onReview={reviewSuggestion} />
      </SideDrawer>

      <SideDrawer open={drawer?.kind === 'summary'} onClose={() => setDrawer(null)} title="Shift summary">
        <ShiftSummary onClose={() => setDrawer(null)} />
      </SideDrawer>

      <SideDrawer open={drawer?.kind === 'patient'} onClose={() => setDrawer(null)}
                  title={drawer?.kind === 'patient' ? `${drawer.row.name} · ${drawer.row.room}` : ''}>
        {drawer?.kind === 'patient' && (
          <div className="flex flex-col gap-4">
            <p className="text-lg">{drawer.row.headline}</p>
            {drawer.row.screen && <p className="text-muted-foreground">Their tablet is showing the {drawer.row.screen} screen.</p>}
            <div className="flex flex-wrap gap-2">
              {drawer.row.open_requests > 0 && (
                <button type="button" className={smallButton} onClick={() => {
                  const a = open.find((x) => x.patient_id === drawer.row.patient_id)
                  if (a) setDrawer({ kind: 'alert', id: a.id })
                }}>Open the request</button>
              )}
              {!checkins.some((l) => l.patient_id === drawer.row.patient_id) && (
                <button type="button" className={smallButton} onClick={() => void start(drawer.row.patient_id)}>
                  Start a check-in
                </button>
              )}
              <Link className={smallButton} href={`/profile/${drawer.row.patient_id}`}>Notes and profile</Link>
            </div>
            <p className="text-sm text-muted-foreground">
              Their trends are in <Link className="font-semibold text-primary" href="/nurse/insights">Insights</Link> and
              what&apos;s likely next is in <Link className="font-semibold text-primary" href="/nurse/forecast">Forecast</Link>.
            </p>
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
