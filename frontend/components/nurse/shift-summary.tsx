'use client'

import { useHandoff } from '@/lib/live/profile'
import type { HandoffPatient } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_LABEL = { attention: 'Needs attention', watch: 'Watch', stable: 'No change' } as const

function communication(p: HandoffPatient): string | null {
  const parts: string[] = []
  if (p.tap_seconds !== null) {
    parts.push(
      p.baseline_seconds
        ? `taps averaged ${p.tap_seconds}s against a usual ${p.baseline_seconds}s`
        : `taps averaged ${p.tap_seconds}s`,
    )
  }
  if (p.inconsistent_answers > 0) {
    parts.push(`${p.inconsistent_answers} inconsistent answer${p.inconsistent_answers === 1 ? '' : 's'}`)
  }
  if (p.mode_changes > 0) parts.push(`${p.mode_changes} access-mode change${p.mode_changes === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : null
}

/** Fixed-structure handoff note. Numbers come from the backend; Gemini writes the headline and
 *  "watch for" lines only. */
export function ShiftSummary({ onClose }: { onClose: () => void }) {
  const { summary, error } = useHandoff(12)

  return (
    <section aria-labelledby="handoff-h" className="flex flex-col gap-4 rounded-3xl border-2 border-primary/30 bg-primary-soft p-5 md:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="handoff-h" className="text-xl font-bold">Shift summary</h2>
        <p className="flex items-baseline gap-3 text-sm text-muted-foreground">
          {summary
            ? `Last ${summary.window_hours}h · ${summary.source === 'gemini' ? 'headlines by Gemini' : 'template headlines (Gemini off)'}`
            : 'Preparing…'}
          <button type="button" onClick={onClose} className="font-semibold text-primary underline-offset-4 hover:underline">
            Close
          </button>
        </p>
      </header>

      {error && <p className="text-sm text-urgent">{error}</p>}
      {summary && summary.patients.length === 0 && (
        <p className="text-base text-muted-foreground">Nothing to hand over: every patient was steady.</p>
      )}

      {summary?.patients.map((p) => {
        const comm = communication(p)
        return (
          <article
            key={p.patient_id}
            className={cn(
              'flex flex-col gap-3 rounded-2xl border bg-card p-4',
              p.status === 'attention' ? 'border-urgent' : 'border-border',
            )}
          >
            <header className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-sm text-muted-foreground">{p.room}</span>
              <span className="font-semibold">{p.name}</span>
              <span
                className={cn(
                  'text-sm font-semibold',
                  p.status === 'attention' ? 'text-urgent' : p.status === 'watch' ? 'text-[oklch(0.52_0.13_70)]' : 'text-muted-foreground',
                )}
              >
                {STATUS_LABEL[p.status]}
              </span>
            </header>
            <p className="text-base font-semibold">{p.headline}</p>
            <dl className="grid gap-1.5 text-sm">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                <dt className="text-muted-foreground">Requests</dt>
                <dd>
                  {p.requests} this shift{p.urgent > 0 && `, ${p.urgent} urgent`}
                  {p.open_urgent > 0 && <strong className="text-urgent"> ({p.open_urgent} still open)</strong>}
                  {p.confirmed.length > 0 && (
                    <>
                      . Confirmed:{' '}
                      {p.confirmed.map((c) => `${c.label.toLowerCase()}${c.count > 1 ? ` ×${c.count}` : ''}`).join(', ')}
                    </>
                  )}
                </dd>
              </div>
              {comm && (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                  <dt className="text-muted-foreground">Communication</dt>
                  <dd>{comm}</dd>
                </div>
              )}
              {p.trends.length > 0 && (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                  <dt className="text-muted-foreground">Trends</dt>
                  <dd>{p.trends.map((t) => t.message).join(' ')}</dd>
                </div>
              )}
              {p.profile.length > 0 && (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                  <dt className="text-muted-foreground">From the notes</dt>
                  <dd>{p.profile.map((q) => `“${q}”`).join(' ')}</dd>
                </div>
              )}
              {p.watch_for && (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                  <dt className="text-muted-foreground">Watch for</dt>
                  <dd>{p.watch_for}</dd>
                </div>
              )}
            </dl>
          </article>
        )
      })}

      {summary && summary.stable.length > 0 && (
        <p className="text-sm text-muted-foreground">
          No change: {summary.stable.map((s) => `${s.name} (${s.room})`).join(', ')}
        </p>
      )}
    </section>
  )
}
