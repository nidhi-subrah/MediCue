'use client'

import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { needLabel } from '@/lib/live/catalog'
import { useResearch } from '@/lib/live/research'
import { timeAgo } from '@/lib/services/backend'
import type { Finding } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<Finding['status'], string> = {
  proposed: 'Awaiting review',
  validated: 'Validated',
  rejected: 'Rejected',
  needs_more_data: 'Needs more data',
}

export function ResearchView() {
  const { findings, running, run, review } = useResearch()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const waiting = findings.filter((f) => f.status === 'proposed').length

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight">Pattern review</h1>
          <p className="text-lg text-muted-foreground">{waiting} awaiting review · {findings.length} total</p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          <FlaskConical className="size-4" aria-hidden="true" />
          {running ? 'Analysing…' : 'Scan for new patterns'}
        </button>
      </header>

      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
        Patterns found in confirmed requests. Validating one adjusts that patient&apos;s starting probabilities;
        rejected patterns are not proposed again.
      </p>

      {findings.length === 0 && (
        <p className="rounded-3xl border border-border bg-card p-6 text-base text-muted-foreground">No patterns yet.</p>
      )}

      {findings.map((f) => (
        <article
          key={f.id}
          className={cn('flex flex-col gap-4 rounded-3xl border border-border bg-card p-6', f.status === 'rejected' && 'opacity-55')}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span
              className={cn(
                'font-semibold',
                f.status === 'validated' && 'text-success',
                f.status === 'needs_more_data' && 'text-[oklch(0.52_0.13_70)]',
              )}
            >
              {STATUS_LABEL[f.status]}
            </span>
            <span>{f.kind.replace(/_/g, ' ')}</span>
            <span>first seen {timeAgo(f.created_at)}</span>
          </div>

          <h2 className="text-xl font-bold">{f.title}</h2>

          <dl className="grid gap-2">
            <div className="grid grid-cols-[7.5rem_1fr] gap-3">
              <dt className="text-sm text-muted-foreground">Evidence</dt>
              <dd className="text-base">{f.evidence}</dd>
            </div>
            <div className="grid grid-cols-[7.5rem_1fr] gap-3">
              <dt className="text-sm text-muted-foreground">Hypothesis</dt>
              <dd className="text-base">
                {f.hypothesis}
                {f.hypothesis_source === 'gemini' && <span className="text-sm text-muted-foreground"> (drafted by Gemini)</span>}
              </dd>
            </div>
            {f.prior_effect && (
              <div className="grid grid-cols-[7.5rem_1fr] gap-3">
                <dt className="text-sm text-muted-foreground">If validated</dt>
                <dd className="text-base">
                  {f.prior_effect.need_ids.map(needLabel).join(', ')} made {f.prior_effect.multiplier}× more likely
                  {f.prior_effect.hours
                    ? ` from ${f.prior_effect.hours[0]}:00 to ${f.prior_effect.hours[f.prior_effect.hours.length - 1] + 1}:00`
                    : ''}
                </dd>
              </div>
            )}
            {f.reviewer && (
              <div className="grid grid-cols-[7.5rem_1fr] gap-3">
                <dt className="text-sm text-muted-foreground">Reviewed</dt>
                <dd className="text-base">{f.reviewer}{f.note ? `: "${f.note}"` : ''}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Reviewer note"
              placeholder="Add a note (optional)"
              value={notes[f.id] ?? ''}
              onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })}
              className="h-11 flex-1 min-w-[220px] rounded-xl border-2 border-input bg-background px-3 text-base"
            />
            <button
              type="button"
              onClick={() => review(f, 'validated', notes[f.id] ?? null)}
              className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Validate
            </button>
            <button
              type="button"
              onClick={() => review(f, 'needs_more_data', notes[f.id] ?? null)}
              className="h-11 rounded-xl border-2 border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
            >
              Needs more data
            </button>
            <button
              type="button"
              onClick={() => review(f, 'rejected', notes[f.id] ?? null)}
              className="h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted"
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
