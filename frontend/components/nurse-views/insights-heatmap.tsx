'use client'

import { X } from 'lucide-react'
import { useInsightsCell } from '@/lib/live/nurse-views'
import type { UnitInsights } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChartCard, dayLabel, hourLabel, whenLabel } from './common'

/** Patients × hours (or days). Shade = number of requests, red dot = at least one urgent request. */
export function InsightsHeatmap({ data }: { data: UnitInsights }) {
  const { heatmap, bucket } = data
  const { cell, open, close } = useInsightsCell()
  const hourly = bucket === '1 hour'
  const label = (iso: string) => (hourly ? hourLabel(iso) : dayLabel(iso))
  const ranked = [...heatmap.patients].sort((a, b) => b.total - a.total)
  const perColumn = heatmap.columns.map((c, i) => ({ c, n: heatmap.patients.reduce((s, p) => s + p.cells[i].requests, 0) }))
  const busiest = perColumn.reduce((a, b) => (b.n > a.n ? b : a), perColumn[0])
  const urgent = heatmap.patients
    .map((p) => ({ name: p.name, n: p.cells.reduce((s, c) => s + c.urgent, 0) }))
    .filter((u) => u.n > 0)
  const bullets: React.ReactNode[] = ranked[0]?.total
    ? [
        <>Most requests: {ranked.slice(0, 2).filter((p) => p.total).map((p, i) => (
          <span key={p.patient_id}>{i ? ', ' : ''}<strong>{p.name}</strong> ({p.total})</span>))}</>,
        <>Busiest {hourly ? 'hour' : 'day'}: <strong>{label(busiest.c)}</strong> ({busiest.n} requests)</>,
        urgent.length
          ? <>Urgent: {urgent.map((u, i) => <span key={u.name}>{i ? ', ' : ''}<strong>{u.name}</strong> ({u.n})</span>)}</>
          : <>No urgent requests</>,
      ]
    : ['No requests in this period yet']

  return (
    <ChartCard id="heat" question="When is everyone needing help?" bullets={bullets} chartLabel="See by hour">
      <p className="text-sm text-muted-foreground">Darker squares mean more requests. Tap a square to see what was asked.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm" aria-describedby="heat-h">
          <thead>
            <tr>
              <th scope="col" className="sr-only">Patient</th>
              {heatmap.columns.map((c, i) => (
                <th key={c} scope="col" className="min-w-7 px-0 text-center text-xs font-medium text-muted-foreground">
                  {!hourly || i % 3 === 0 ? label(c) : <span className="sr-only">{label(c)}</span>}
                </th>
              ))}
              <th scope="col" className="px-2 text-right text-xs font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {heatmap.patients.map((p) => (
              <tr key={p.patient_id}>
                <th scope="row" className="whitespace-nowrap pr-3 text-left font-semibold">
                  {p.name} <span className="font-mono text-xs font-normal text-muted-foreground">{p.room}</span>
                </th>
                {p.cells.map((c) => {
                  const share = heatmap.max ? c.requests / heatmap.max : 0
                  return (
                    <td key={c.start} className="p-0">
                      <button
                        type="button"
                        disabled={!c.requests}
                        onClick={() => void open(p.patient_id, c.start, bucket)}
                        aria-label={`${p.name}, ${label(c.start)}: ${c.requests} request${c.requests === 1 ? '' : 's'}${c.urgent ? `, ${c.urgent} urgent` : ''}`}
                        className={cn(
                          'relative flex h-9 w-full min-w-7 items-center justify-center rounded-md border text-xs font-semibold tabular-nums',
                          c.requests ? 'border-transparent hover:ring-2 hover:ring-primary/40' : 'border-dashed border-border bg-card',
                        )}
                        style={c.requests ? {
                          background: `color-mix(in oklch, var(--primary) ${Math.round(18 + share * 72)}%, var(--card))`,
                          color: share > 0.45 ? 'var(--primary-foreground)' : 'var(--foreground)',
                        } : undefined}
                      >
                        {c.requests || ''}
                        {c.urgent > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-urgent ring-2 ring-card" aria-hidden="true" />
                        )}
                      </button>
                    </td>
                  )
                })}
                <td className="px-2 text-right font-mono tabular-nums">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2.5 rounded-full bg-urgent" aria-hidden="true" /> At least one urgent request
        <span className="ml-3 inline-block h-4 w-6 rounded border border-dashed border-border" aria-hidden="true" /> No requests
      </p>

      {cell && (
        <div className="rounded-2xl border border-border bg-surface p-4" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-bold">
              {cell.name} · {hourly ? whenLabel(cell.start) : dayLabel(cell.start)}
            </h3>
            <button type="button" onClick={close} aria-label="Close" className="rounded-full p-1 hover:bg-muted">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {cell.items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm text-muted-foreground">{new Date(it.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="font-semibold">{it.label}</span>
                <span className="text-sm text-muted-foreground">{it.group}</span>
                {it.urgent && <span className="rounded-full bg-urgent-soft px-2 text-xs font-semibold text-urgent">Urgent</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}
