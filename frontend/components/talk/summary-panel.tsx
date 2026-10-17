'use client'

import { ActivitySquare, ListChecks } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { needLabel } from '@/lib/live/catalog'
import { pct } from '@/lib/services/backend'
import type { SessionState } from '@/lib/types'
import { ProfileList } from '@/components/profile/profile-list'
import { BeliefBars } from './belief-bars'

const KIND_LABEL: Record<string, string> = {
  ask: 'Asked', lookup: 'Looked up', consult: 'Consulted', escalate: 'Escalated', send: 'Sent', tap: 'Choice',
}

export function SummaryPanel({
  session,
  showEngine,
  onToggleEngine,
}: {
  session: SessionState
  showEngine: boolean
  onToggleEngine: () => void
}) {
  const d = session.last_decision

  return (
    <section aria-labelledby="summary-title" className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="summary-title" className="text-base font-bold">What&apos;s happened so far</h2>
        <button
          type="button"
          onClick={onToggleEngine}
          aria-pressed={showEngine}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ActivitySquare className="size-4" aria-hidden="true" />
          Engine
        </button>
      </div>

      {session.trace.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-surface p-4 text-sm leading-relaxed text-muted-foreground">
          Nothing yet. Each choice appears here, so you and your care team can see exactly what was said.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {session.trace.map((t, i) => (
              <motion.li
                key={`${t.kind}-${t.t}-${i}`}
                layout
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                className="flex items-start gap-3 rounded-2xl bg-surface p-3"
              >
                <ListChecks className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {KIND_LABEL[t.kind] ?? t.kind}
                  </span>
                  <span className="font-semibold leading-snug text-pretty">{t.label}</span>
                  {t.top.length > 0 && (
                    <span className="mt-1 text-xs text-muted-foreground">
                      {t.top.slice(0, 2).map((x) => `${x.label} ${pct(x.p)}`).join(' · ')}
                    </span>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      {showEngine && (
        <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'High-risk', value: pct(session.p_high), hot: session.p_high >= 0.25 },
              { label: 'Uncertainty', value: `${session.entropy.toFixed(2)} bits` },
              { label: 'Fatigue', value: `${session.fatigue.toFixed(1)}×` },
              { label: 'Inputs', value: String(session.taps) },
            ].map((r) => (
              <div key={r.label} className="flex flex-col-reverse gap-0.5">
                <span className="text-[0.7rem] text-muted-foreground">{r.label}</span>
                <span className={`font-mono text-base tabular-nums ${r.hot ? 'text-urgent' : ''}`}>{r.value}</span>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold">Belief</h3>
            <BeliefBars items={session.belief} set={session.prediction_set} />
            <p className="mt-2 text-xs text-muted-foreground">90% set: {session.prediction_set.map(needLabel).join(', ')}</p>
            {session.prior_reasons.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Prior shaped by {session.prior_reasons.join(', ')}</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold">Patient profile</h3>
            <ProfileList items={session.profile ?? []} empty="No profile (Gemini off or nothing in the notes)." />
            <p className="mt-2 text-xs text-muted-foreground">
              {session.baseline_interval
                ? `Usual pace ${session.baseline_interval.toFixed(1)}s between inputs`
                : 'No personal pace baseline yet'}
              {session.inconsistencies > 0 &&
                ` · ${session.inconsistencies} inconsistent answer${session.inconsistencies === 1 ? '' : 's'}`}
            </p>
          </div>

          {d && (
            <div>
              <h3 className="mb-2 text-sm font-bold">Decision: {KIND_LABEL[d.chosen.kind] ?? d.chosen.kind}</h3>
              <p className="text-xs text-muted-foreground">{d.reason}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
