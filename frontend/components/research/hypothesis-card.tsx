'use client'

import { useState } from 'react'
import { needLabel } from '@/lib/live/catalog'
import type { HypothesisStatus, ResearchHypothesis } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ConfidenceBar } from './confidence-bar'

export const STATUS_LABEL: Record<HypothesisStatus, string> = {
  INVESTIGATING: 'Investigating',
  WAITING_FOR_CLINICIAN: 'Waiting for a clinician',
  INCONCLUSIVE: 'Inconclusive, still watching',
  SUPPORTED_PENDING_REVIEW: 'Supported, awaiting review',
  REJECTED_PENDING_REVIEW: 'Not supported, awaiting review',
  VALIDATED: 'Validated',
  REJECTED: 'Rejected',
}

const ACTION_LABEL: Record<string, string> = {
  CHECK_DATA: 'Check data',
  ASK_CLINICIAN: 'Ask clinician',
  WAIT: 'Wait',
  REVIEW: 'Clinical lead review',
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayHhmm = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function HypothesisCard({
  h,
  mode,
  onReview,
}: {
  h: ResearchHypothesis
  mode: 'active' | 'review' | 'history'
  onReview: (decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) => Promise<unknown>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const supporting = h.evidence.reduce((n, e) => n + e.supports, 0)
  const contradicting = h.evidence.reduce((n, e) => n + e.contradicts, 0)
  const trace = h.decision_trace
  const eff = h.prior_effect

  const review = async (decision: 'validated' | 'rejected' | 'needs_more_data') => {
    setBusy(true)
    try {
      await onReview(decision, note || null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-3xl border p-5 md:p-6',
        h.status === 'VALIDATED' && 'border-success/30 bg-success-soft',
        h.status === 'REJECTED' && 'border-border bg-card opacity-55',
        h.status !== 'VALIDATED' && h.status !== 'REJECTED' && 'border-border bg-card',
      )}
    >
      <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span
          className={cn(
            'font-semibold',
            h.status === 'VALIDATED' && 'text-success',
            (h.status === 'SUPPORTED_PENDING_REVIEW' || h.status === 'REJECTED_PENDING_REVIEW') && 'text-[oklch(0.52_0.13_70)]',
          )}
        >
          {STATUS_LABEL[h.status]}
        </span>
        <span>{h.origin === 'clinician' ? 'Clinician observation' : 'System detected'}</span>
        <span>{h.cohort}</span>
      </p>

      <h2 className="text-xl font-bold">{h.statement}</h2>

      {h.observation_text && (
        <blockquote className="rounded-2xl border-l-4 border-primary/40 bg-surface py-2 pl-4 text-base italic text-muted-foreground">
          &ldquo;{h.observation_text}&rdquo; <cite className="not-italic">— {h.origin_detail}</cite>
        </blockquote>
      )}

      <ConfidenceBar confidence={h.confidence} thresholds={h.thresholds} />

      <dl className="grid gap-2">
        <div className="grid grid-cols-[7.5rem_1fr] gap-3">
          <dt className="text-sm text-muted-foreground">Evidence</dt>
          <dd className="text-base">
            <span className="text-success">+{supporting} supporting</span> ·{' '}
            <span className="text-urgent">−{contradicting} contradicting</span>
          </dd>
        </div>
        {h.origin === 'system' && (
          <div className="grid grid-cols-[7.5rem_1fr] gap-3">
            <dt className="text-sm text-muted-foreground">Origin</dt>
            <dd className="text-base">{h.origin_detail}. {h.discovery}</dd>
          </div>
        )}
        <div className="grid grid-cols-[7.5rem_1fr] gap-3">
          <dt className="text-sm text-muted-foreground">Last action</dt>
          <dd className="text-base">{h.last_action ? ACTION_LABEL[h.last_action] : 'None yet'}</dd>
        </div>
        {h.next_action && (
          <div className="grid grid-cols-[7.5rem_1fr] gap-3">
            <dt className="text-sm text-muted-foreground">Next action</dt>
            <dd className="text-base">{h.next_action.label}</dd>
          </div>
        )}
        {h.rationale && mode !== 'history' && (
          <div className="grid grid-cols-[7.5rem_1fr] gap-3">
            <dt className="text-sm text-muted-foreground">Possible reason</dt>
            <dd className="text-base">
              {h.rationale}
              {h.rationale_source === 'gemini' && <span className="text-sm text-muted-foreground"> (drafted by Gemini)</span>}
            </dd>
          </div>
        )}
        {eff && (
          <div className="grid grid-cols-[7.5rem_1fr] gap-3">
            <dt className="text-sm text-muted-foreground">{h.status === 'VALIDATED' ? 'Now applied' : 'If validated'}</dt>
            <dd className="text-base">
              {eff.need_ids.map(needLabel).join(', ')} made {eff.multiplier}× more likely
              {eff.after_visit_h ? ` for ${eff.after_visit_h} h after a family visit ends` : ''}
              {eff.hours ? ` from ${eff.hours[0]}:00 to ${eff.hours[eff.hours.length - 1] + 1}:00` : ''}
            </dd>
          </div>
        )}
        {mode === 'history' && h.reviewer && (
          <div className="grid grid-cols-[7.5rem_1fr] gap-3">
            <dt className="text-sm text-muted-foreground">Reviewed</dt>
            <dd className="text-base">{h.reviewer}{h.note ? `: "${h.note}"` : ''}</dd>
          </div>
        )}
      </dl>

      {trace && mode !== 'history' && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-primary">Agent decision trace</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-muted-foreground">
              Scores from the research decision engine at {Math.round(trace.confidence * 100)}% confidence ({hhmm(trace.t)}).
              Score = expected information gain in bits minus costs. Deterministic arithmetic, not LLM reasoning.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="border-b border-border pb-1 pr-2 font-medium">Action</th>
                    <th className="border-b border-border pb-1 pr-2 text-right font-medium">Info gain</th>
                    <th className="border-b border-border pb-1 pr-2 text-right font-medium">Cost</th>
                    <th className="border-b border-border pb-1 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.ranked.map((a, i) => (
                    <tr key={a.kind + (a.target ?? '')} className={i === 0 ? 'font-semibold text-primary' : ''}>
                      <td className="border-b border-border py-1 pr-2">
                        {a.kind}
                        {a.target ? ` · ${a.label.replace(/^Ask /, '')}` : ''}
                        {'clinician_reliability' in a.detail && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            reliability {Number(a.detail.clinician_reliability).toFixed(2)}
                            {a.detail.note ? `, ${a.detail.note}` : ''}
                          </span>
                        )}
                        {'new_episodes' in a.detail && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{a.detail.new_episodes} new episode(s)</span>
                        )}
                      </td>
                      <td className="border-b border-border py-1 pr-2 text-right font-mono tabular-nums">{a.eig.toFixed(2)}</td>
                      <td
                        className="border-b border-border py-1 pr-2 text-right font-mono tabular-nums"
                        title={Object.entries(a.costs).map(([k, v]) => `${k.replace('_', ' ')} ${v.toFixed(2)}`).join(', ')}
                      >
                        {Object.values(a.costs).reduce((x, y) => x + y, 0).toFixed(2)}
                      </td>
                      <td className="border-b border-border py-1 text-right font-mono tabular-nums">{a.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">
              Selected: <strong className="text-foreground">{trace.selected_label}</strong>
            </p>
          </div>
        </details>
      )}

      <details className="text-sm" open={mode === 'review'}>
        <summary className="w-fit cursor-pointer text-primary">Timeline ({h.timeline.length})</summary>
        <ol className="mt-3 flex flex-col gap-2">
          {h.timeline.map((t, i) => (
            <li key={i} className="grid grid-cols-[6rem_1fr] gap-2 border-b border-border pb-1.5 last:border-0">
              <time className="font-mono text-xs text-muted-foreground" dateTime={t.t}>
                {mode === 'history' ? dayHhmm(t.t) : hhmm(t.t)}
              </time>
              <span>{t.text}</span>
            </li>
          ))}
        </ol>
      </details>

      {h.evidence.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-primary">Evidence trail ({h.evidence.length})</summary>
          <ol className="mt-3 flex flex-col gap-3">
            {h.evidence.map((e) => (
              <li key={e.id} className="border-b border-border pb-2 last:border-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{e.source}</span>
                  <span>{e.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    confidence {Math.round(e.confidence_before * 100)}% → {Math.round(e.confidence_after * 100)}%
                  </span>
                </div>
                {e.episodes && e.episodes.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 pl-4 text-sm">
                    {e.episodes.map((ep, i) => (
                      <li key={i}>
                        <span className={ep.supports ? 'text-success' : 'text-urgent'}>{ep.supports ? '+' : '−'}</span>{' '}
                        {dayHhmm(ep.time)} · {ep.label}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      {mode === 'review' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Reviewer note"
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-11 w-full flex-1 rounded-xl border-2 border-input bg-background px-3 text-base sm:min-w-[220px]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => review('validated')}
            className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Validate
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => review('needs_more_data')}
            className="h-11 rounded-xl border-2 border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-40"
          >
            Needs more data
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => review('rejected')}
            className="h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      )}
    </article>
  )
}
