'use client'

import { cn } from '@/lib/utils'
import type { GaugeLevel, NeedGroupRef } from '@/lib/types'

/** One colour per need type. Every chart also names the type in text (legend, labels), never colour alone. */
export const GROUP_COLOR: Record<string, string> = {
  pain: 'oklch(0.6 0.13 35)',
  breathing: 'oklch(0.52 0.12 300)',
  toileting: 'oklch(0.55 0.1 235)',
  comfort: 'oklch(0.6 0.1 160)',
  emotional: 'oklch(0.66 0.11 85)',
}

export const LEVEL_STYLE: Record<GaugeLevel, { dot: string; chip: string; word: string }> = {
  green: { dot: 'bg-success', chip: 'bg-success-soft text-success', word: 'As usual' },
  amber: { dot: 'bg-caution', chip: 'bg-caution-soft text-caution', word: 'Keep an eye on' },
  red: { dot: 'bg-urgent', chip: 'bg-urgent-soft text-urgent', word: 'Check in' },
  unknown: { dot: 'bg-muted-foreground/40', chip: 'bg-muted text-muted-foreground', word: 'Not enough data' },
}

export const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric' })
export const dayLabel = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
export const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

export function duration(seconds: number | null) {
  if (seconds === null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`
}

/** One section: the question it answers, a few plain-language bullet points, and (optionally) the chart
 *  behind a "See chart" toggle, closed by default so the page reads as a short list. */
export function ChartCard({
  id,
  question,
  bullets,
  actions,
  children,
  chartLabel = 'See chart',
  className,
}: {
  id: string
  question: string
  bullets: React.ReactNode[]
  actions?: React.ReactNode
  children?: React.ReactNode
  chartLabel?: string
  className?: string
}) {
  return (
    <section aria-labelledby={`${id}-h`} className={cn('flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 md:p-6', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`${id}-h`} className="text-xl font-bold text-balance">{question}</h2>
        {actions}
      </header>
      <ul className="flex list-disc flex-col gap-1.5 pl-6 text-lg leading-relaxed marker:text-muted-foreground">
        {bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      {children && (
        <details className="group mt-1">
          <summary className="inline-flex min-tap cursor-pointer list-none items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold text-primary hover:bg-muted [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{chartLabel}</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <div className="mt-4 flex flex-col gap-4">{children}</div>
        </details>
      )}
    </section>
  )
}

/** "Wei Chen, Rosa Alvarez and Irena Kowalski" */
export function names(list: string[]) {
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export function LevelChip({ level, children }: { level: GaugeLevel; children: React.ReactNode }) {
  const s = LEVEL_STYLE[level]
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold', s.chip)}>
      <span className={cn('size-2.5 shrink-0 rounded-full', s.dot)} aria-hidden="true" />
      {children}
    </span>
  )
}

export function Legend({ groups }: { groups: NeedGroupRef[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Request types">
      {groups.map((g) => (
        <li key={g.id} className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: GROUP_COLOR[g.id] }} aria-hidden="true" />
          {g.label}
        </li>
      ))}
    </ul>
  )
}

export function Toggle<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 gap-1 rounded-full border border-border bg-surface p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
            o.value === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-surface px-4 py-3 text-sm leading-relaxed text-muted-foreground">{children}</p>
}
