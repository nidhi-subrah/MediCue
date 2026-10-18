'use client'

import { MessageSquare, Shuffle, Siren, Users, type LucideIcon } from 'lucide-react'
import type { UnitInsights } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChartCard, Toggle, hourLabel, names } from './common'

const KIND: Record<string, { icon: LucideIcon; label: string; className: string }> = {
  request: { icon: MessageSquare, label: 'Request', className: 'bg-primary text-primary-foreground' },
  urgent: { icon: Siren, label: 'Urgent alert', className: 'bg-urgent text-urgent-foreground' },
  consult: { icon: Users, label: 'Family asked', className: 'bg-success text-success-foreground' },
  change: { icon: Shuffle, label: 'Screen made easier or harder', className: 'bg-caution text-white' },
}

/** One lane per patient over the last 12 or 24 hours. */
export function InsightsTimeline({
  data,
  hours,
  onHours,
}: {
  data: UnitInsights
  hours: number
  onHours: (h: number) => void
}) {
  const { timeline } = data
  const t0 = new Date(timeline.since).getTime()
  const t1 = new Date(timeline.until).getTime()
  const x = (iso: string) => ((new Date(iso).getTime() - t0) / (t1 - t0)) * 100
  const ticks = Array.from({ length: hours / 3 + 1 }, (_, i) => new Date(t0 + i * 3 * 3600e3).toISOString())
  const at = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const active = timeline.patients.filter((p) => p.items.length)
  const quiet = timeline.patients.filter((p) => !p.items.length).map((p) => p.name)
  const bullets: React.ReactNode[] = active.map((p) => {
    const count = (k: string) => p.items.filter((i) => i.kind === k).length
    const parts = [
      count('request') && `${count('request')} request${count('request') === 1 ? '' : 's'}`,
      count('urgent') && `${count('urgent')} urgent`,
      count('consult') && `family asked ${count('consult')}×`,
      count('change') && 'screen changed',
    ].filter(Boolean)
    const last = p.items[p.items.length - 1]
    return <><strong>{p.name}</strong>: {parts.join(', ')} · latest {last.label.replace(' · confirmed', '')} at {at(last.time)}</>
  })
  if (quiet.length) bullets.push(<>Nothing from {names(quiet)}</>)

  return (
    <ChartCard
      id="timeline"
      question={`What happened in the last ${hours} hours?`}
      bullets={bullets}
      chartLabel="See timeline"
      actions={<Toggle label="Timeline length" value={hours} onChange={onHours}
                       options={[{ value: 12, label: '12 h' }, { value: 24, label: '24 h' }]} />}
    >
      <div className="flex flex-col gap-1">
        {timeline.patients.map((p) => (
          <div key={p.patient_id} className="grid grid-cols-[9rem_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr]">
            <div className="truncate font-semibold">
              {p.name} <span className="font-mono text-xs font-normal text-muted-foreground">{p.room}</span>
            </div>
            <div className="relative h-10 rounded-xl bg-surface">
              <ul aria-label={`${p.name}: ${p.items.length} events`}>
                {p.items.map((it, i) => {
                  const k = KIND[it.kind]
                  const Icon = k.icon
                  const at = new Date(it.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                  return (
                    <li key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(it.time)}%` }}>
                      <span
                        tabIndex={0}
                        title={`${at} · ${it.label}`}
                        aria-label={`${at}: ${it.label}`}
                        className={cn('flex size-7 items-center justify-center rounded-full ring-2 ring-card focus-visible:outline-2', k.className)}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[9rem_1fr] gap-3 sm:grid-cols-[11rem_1fr]" aria-hidden="true">
          <span />
          <div className="relative h-5 text-xs text-muted-foreground">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>{hourLabel(t)}</span>
            ))}
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {Object.entries(KIND).map(([key, k]) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span className={cn('flex size-5 items-center justify-center rounded-full', k.className)}><k.icon className="size-3" aria-hidden="true" /></span>
            {k.label}
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
