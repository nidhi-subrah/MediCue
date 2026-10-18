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
import { PageHeader } from '@/components/app/page-header'

type Drawer = { kind: 'alert'; id: string; openCase?: boolean } | { kind: 'patient'; row: NurseBoardRow }
  | { kind: 'suggestions' } | { kind: 'summary' } | null

const smallButton = 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium shadow-[var(--shadow-panel)] hover:bg-muted'

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
    { n: urgent.length, label: 'Urgent', dot: urgent.length ? 'bg-urgent' : 'bg-border' },
    { n: routine.length, label: 'Waiting', dot: routine.length ? 'bg-primary' : 'bg-border' },
    { n: checkins.length, label: 'Check-ins', dot: checkins.length ? 'bg-caution' : 'bg-border' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<>Unit overview · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</>}
        title="Nurse station"
        actions={<nav aria-label="Nurse tools" className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} onClick={() => setDrawer({ kind: 'summary' })}>
            <ClipboardList className="size-4" aria-hidden="true" /> Shift summary
          </button>
          <Link href="/nurse/insights" className={smallButton}><ChartColumn className="size-4" aria-hidden="true" /> Insights</Link>
          <Link href="/nurse/forecast" className={smallButton}><TrendingUp className="size-4" aria-hidden="true" /> Forecast</Link>
          <details className="relative">
            <summary className={cn(smallButton, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
              <FlaskConical className="size-4" aria-hidden="true" /> Demo
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-[min(32rem,90vw)] rounded-xl border border-border bg-card p-4 shadow-xl">
              <DemoScenarioBar onAlert={setDemoAlert} />
            </div>
          </details>
        </nav>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counters.map((c) => (
          <div key={c.label} className="panel flex flex-col gap-3 px-5 py-4">
            <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className={cn('size-2 rounded-full', c.dot)} aria-hidden="true" />{c.label}
            </span>
            <span className="num text-4xl font-semibold leading-none">{c.n}</span>
          </div>
        ))}
        <button type="button" onClick={() => setDrawer({ kind: 'suggestions' })} disabled={!suggestions.length}
                className="panel flex flex-col gap-3 px-5 py-4 text-left hover:border-primary/40 disabled:hover:border-border">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className={cn('size-2 rounded-full', pending.length ? 'bg-primary' : 'bg-border')} aria-hidden="true" />
            To review{pending.length > 0 && ' ›'}
          </span>
          <span className="num text-4xl font-semibold leading-none">{pending.length}</span>
        </button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="queue-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="queue-h" className="text-base font-semibold tracking-tight">Needs you now</h2>
          {urgent.map((a) => <QueueAlert key={a.id} alert={a} onConfirm={(n) => confirm(a.id, n, null, null)}
                                         onDetails={() => setDrawer({ kind: 'alert', id: a.id })} />)}
          {checkins.map((l) => <QueueCheckIn key={l.id} ladder={l} onAcknowledge={() => acknowledge(l)} />)}
          {routine.map((a) => <QueueAlert key={a.id} alert={a} onConfirm={(n) => confirm(a.id, n, null, null)}
                                          onDetails={() => setDrawer({ kind: 'alert', id: a.id })} />)}
          {!open.length && !checkins.length && (
            <p className="rounded-xl border border-dashed border-input bg-card p-6 text-base text-muted-foreground">
              Nothing needs you right now. Requests from bedside tablets appear here as they come in.
            </p>
          )}
          {done.length > 0 && (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setShowDone((v) => !v)}
                      className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline">
                {showDone ? 'Hide' : 'Done today'} ({done.length})
              </button>
              {showDone && (
                <ul className="panel flex flex-col divide-y divide-border text-sm">
                  {done.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setDrawer({ kind: 'alert', id: a.id })}
                              className="flex w-full flex-wrap items-baseline gap-2 px-4 py-2.5 text-left hover:bg-muted/60">
                        <span className="num text-muted-foreground">
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
          <h2 id="unit-h" className="text-base font-semibold tracking-tight">Unit right now</h2>
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
