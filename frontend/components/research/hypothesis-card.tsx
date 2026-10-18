'use client'

import {
  CircleCheck, CircleDashed, CircleX, Clock, Database, Hourglass, MessageCircleQuestion, ScanSearch, UserRound,
} from 'lucide-react'
import { useId, useState } from 'react'
import { needLabel } from '@/lib/live/catalog'
import { pct } from '@/lib/services/backend'
import type { HypothesisStatus, ResearchEvidence, ResearchHypothesis, ResearchInquiry, TimelineEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

/** What the agent is doing, in words and with an icon; colour only reinforces it. */
export function stageOf(h: ResearchHypothesis): { label: string; icon: typeof Clock; tone: string } {
  const s: HypothesisStatus = h.status
  if (s === 'VALIDATED') return { label: 'Validated', icon: CircleCheck, tone: 'text-success bg-success-soft' }
  if (s === 'REJECTED') return { label: 'Rejected', icon: CircleX, tone: 'text-muted-foreground bg-muted' }
  if (s === 'SUPPORTED_PENDING_REVIEW') return { label: 'Pending validation · supported', icon: Hourglass, tone: 'text-caution bg-caution-soft' }
  if (s === 'REJECTED_PENDING_REVIEW') return { label: 'Pending validation · not supported', icon: Hourglass, tone: 'text-caution bg-caution-soft' }
  if (s === 'WAITING_FOR_CLINICIAN') return { label: 'Waiting for clinician', icon: MessageCircleQuestion, tone: 'text-primary bg-primary-soft' }
  if (s === 'INCONCLUSIVE' || h.last_action === 'WAIT') return { label: 'Waiting for more evidence', icon: Clock, tone: 'text-primary bg-primary-soft' }
  if (h.last_action === 'CHECK_DATA') return { label: 'Checking data', icon: Database, tone: 'text-primary bg-primary-soft' }
  return { label: 'Investigating', icon: ScanSearch, tone: 'text-primary bg-primary-soft' }
}

export const PENDING_REVIEW = new Set<HypothesisStatus>(['SUPPORTED_PENDING_REVIEW', 'REJECTED_PENDING_REVIEW'])

const ACTION_WORDS: Record<string, string> = { CHECK_DATA: 'Check the data', ASK_CLINICIAN: 'Ask a clinician', WAIT: 'Wait for more episodes' }
const COST_WORDS: Record<string, string> = { compute: 'Compute', delay: 'Delay', burden: 'Clinician time', unchecked_data: 'Unchecked data' }
const KIND_WORDS: Record<TimelineEntry['kind'], string> = {
  created: 'Created', action: 'Agent action', evidence: 'Evidence', confidence: 'Confidence', status: 'Status',
  review: 'Review', note: 'Note',
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayHhmm = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function evidenceCounts(h: ResearchHypothesis) {
  return {
    supporting: h.evidence.reduce((n, e) => n + e.supports, 0),
    contradicting: h.evidence.reduce((n, e) => n + e.contradicts, 0),
    inconclusive: h.evidence.filter((e) => e.supports === 0 && e.contradicts === 0).length,
  }
}

function currentAction(h: ResearchHypothesis, inquiry: ResearchInquiry | undefined): string {
  if (h.status === 'VALIDATED' || h.status === 'REJECTED') {
    return h.reviewer ? `Reviewed by ${h.reviewer}` : 'Review complete'
  }
  if (PENDING_REVIEW.has(h.status)) return 'Awaiting the clinical lead’s review'
  if (inquiry) return `Awaiting response from ${inquiry.clinician_name}, ${inquiry.clinician_role}`
  if (h.next_action) return h.next_action.label
  if (h.decision_trace) return `Last chose: ${h.decision_trace.selected_label}`
  return 'No action taken yet'
}

/** One hypothesis. Collapsed: what was noticed, where it stands, what happens next. "View investigation"
 *  reveals the agent's recorded timeline, evidence, confidence history and decision scores. */
export function HypothesisCard({
  h,
  inquiry,
  onReview,
}: {
  h: ResearchHypothesis
  inquiry?: ResearchInquiry
  onReview: (decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const panel = useId()
  const stage = stageOf(h)
  const counts = evidenceCounts(h)
  const done = h.status === 'VALIDATED' || h.status === 'REJECTED'

  return (
    <article className={cn('flex flex-col gap-3 rounded-2xl border bg-card p-5', h.status === 'REJECTED' && 'opacity-70',
                           PENDING_REVIEW.has(h.status) ? 'border-caution/50' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold', stage.tone)}>
          <stage.icon className="size-4" aria-hidden="true" /> {stage.label}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {h.origin === 'clinician' ? <UserRound className="size-4" aria-hidden="true" /> : <ScanSearch className="size-4" aria-hidden="true" />}
          {h.origin === 'clinician' ? 'Clinician observation' : 'System detected'}
        </span>
        <span className="text-muted-foreground">· {h.cohort}</span>
      </div>

      <h3 className="text-lg font-bold leading-snug text-balance">{h.statement}</h3>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Estimate</dt>
        <dd>
          <span className="font-semibold tabular-nums">{pct(h.confidence)}</span>{' '}
          <span className="text-muted-foreground">prototype hypothesis estimate, not a clinical probability</span>
        </dd>
        <dt className="text-muted-foreground">Now</dt>
        <dd className="font-medium">{currentAction(h, inquiry)}</dd>
        <dt className="text-muted-foreground">Evidence</dt>
        <dd>
          {counts.supporting} supporting · {counts.contradicting} contradicting
          {counts.inconclusive > 0 && ` · ${counts.inconclusive} inconclusive`}
          {h.evidence.length === 0 && <span className="text-muted-foreground"> (none gathered yet)</span>}
        </dd>
      </dl>

      {PENDING_REVIEW.has(h.status) && <ReviewControls onReview={onReview} />}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className="self-start rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline"
      >
        {open ? 'Hide investigation' : 'View investigation'}
      </button>

      {open && (
        <div id={panel} className="flex flex-col gap-5 border-t border-border pt-4">
          <Section title="Investigation timeline">
            <Timeline h={h} />
          </Section>
          <Section title="Evidence">
            <Evidence h={h} />
          </Section>
          <Section title="Confidence history">
            <ConfidenceHistory h={h} />
          </Section>
          {!done && (
            <details className="rounded-xl bg-surface p-3 text-sm [&[open]>summary]:mb-3">
              <summary className="cursor-pointer font-semibold">How MediCue chose its next action</summary>
              <DecisionTrace h={h} />
            </details>
          )}
          <Section title="Original context">
            <Context h={h} />
          </Section>
        </div>
      )}
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

function ReviewControls({ onReview }: { onReview: (d: 'validated' | 'rejected' | 'needs_more_data', note: string | null) => Promise<unknown> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const review = async (d: 'validated' | 'rejected' | 'needs_more_data') => {
    setBusy(true)
    setError(null)
    try {
      await onReview(d, note || null)
    } catch (e) {
      setError(`Couldn't save the review: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-caution-soft/60 p-3">
      <p className="text-sm font-medium">Human review is required before this is treated as a finding.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Reviewer note" placeholder="Add a note (optional)" value={note} disabled={busy}
               onChange={(e) => setNote(e.target.value)}
               className="min-h-11 w-full flex-1 rounded-xl border border-input bg-background px-3 text-base sm:min-w-[200px]" />
        <button type="button" disabled={busy} onClick={() => review('validated')}
                className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
          Validate
        </button>
        <button type="button" disabled={busy} onClick={() => review('needs_more_data')}
                className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-40">
          Needs more data
        </button>
        <button type="button" disabled={busy} onClick={() => review('rejected')}
                className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-40">
          Reject
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-urgent">{error}</p>}
    </div>
  )
}

function Timeline({ h }: { h: ResearchHypothesis }) {
  if (!h.timeline.length) return <p className="text-sm text-muted-foreground">No recorded history yet.</p>
  const sameDay = new Set(h.timeline.map((t) => new Date(t.t).toDateString())).size === 1
  return (
    <ol className="flex flex-col">
      {h.timeline.map((t, i) => (
        <li key={i} className="grid grid-cols-[5.5rem_1fr] gap-3 border-l-2 border-border py-1.5 pl-3 text-sm sm:grid-cols-[7rem_1fr]">
          <time className="font-mono text-xs text-muted-foreground" dateTime={t.t}>{sameDay ? hhmm(t.t) : dayHhmm(t.t)}</time>
          <span>
            <span className="font-semibold">{KIND_WORDS[t.kind]}</span> · {t.text}
            {t.score !== undefined && <span className="text-muted-foreground"> (score {t.score.toFixed(2)})</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Evidence({ h }: { h: ResearchHypothesis }) {
  if (!h.evidence.length) return <p className="text-sm text-muted-foreground">No evidence gathered yet.</p>
  const groups: { title: string; items: ResearchEvidence[] }[] = [
    { title: 'Supporting', items: h.evidence.filter((e) => e.supports > e.contradicts) },
    { title: 'Contradicting', items: h.evidence.filter((e) => e.contradicts > e.supports) },
    { title: 'Mixed or inconclusive', items: h.evidence.filter((e) => e.supports === e.contradicts) },
  ]
  return (
    <div className="flex flex-col gap-3">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold">{g.title} ({g.items.length})</p>
          <ul className="flex flex-col gap-1.5">
            {g.items.map((e) => (
              <li key={e.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                <p>
                  <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {e.source === 'data' ? 'Data query' : 'Clinician'}
                  </span>
                  {e.summary}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dayHhmm(e.t)} · estimate {pct(e.confidence_before)} → {pct(e.confidence_after)}
                  {e.response && ` · answered “${e.response}”`}
                </p>
                {e.note && <p className="mt-1 italic text-muted-foreground">“{e.note}”</p>}
                {e.episodes && e.episodes.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-primary">
                      {e.episodes.length} episode{e.episodes.length === 1 ? '' : 's'} checked
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5 pl-1 text-xs">
                      {e.episodes.map((ep, i) => (
                        <li key={i}>
                          <span className={ep.supports ? 'text-success' : 'text-urgent'}>{ep.supports ? 'Supports' : 'Contradicts'}</span>
                          {' · '}{dayHhmm(ep.time)} · {ep.label}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The estimate after each piece of evidence, from the values recorded with it. */
function ConfidenceHistory({ h }: { h: ResearchHypothesis }) {
  const ev = [...h.evidence].sort((a, b) => a.t.localeCompare(b.t))
  if (!ev.length) {
    return <p className="text-sm text-muted-foreground">Only the current estimate ({pct(h.confidence)}) is recorded so far.</p>
  }
  const points = [ev[0].confidence_before, ...ev.map((e) => e.confidence_after)]
  const W = 220, H = 44, P = 4
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(points.length - 1, 1)
  const y = (v: number) => H - P - v * (H - 2 * P)
  const ty = (v: number) => y(v).toFixed(1)
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" className="shrink-0"
           aria-label={`Estimate over time: ${points.map(pct).join(', ')}`}>
        {[h.thresholds.reject, h.thresholds.support].map((t) => (
          <line key={t} x1={P} x2={W - P} y1={ty(t)} y2={ty(t)} className="stroke-border" strokeWidth={1} />
        ))}
        <path d={points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${ty(v)}`).join('')} fill="none"
              className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((v, i) => <circle key={i} cx={x(i)} cy={ty(v)} r={3} className="fill-primary"><title>{pct(v)}</title></circle>)}
      </svg>
      <p className="text-sm">
        <span className="font-mono tabular-nums">{points.map(pct).join(' → ')}</span>
        <span className="block text-xs text-muted-foreground">
          Lines mark the review thresholds ({pct(h.thresholds.reject)} and {pct(h.thresholds.support)}).
        </span>
      </p>
    </div>
  )
}

function DecisionTrace({ h }: { h: ResearchHypothesis }) {
  const trace = h.decision_trace
  if (!trace) return <p className="text-muted-foreground">No decision recorded yet: the agent hasn’t scored its options for this hypothesis.</p>
  const best = trace.ranked[0]
  const bestCost = best ? Object.values(best.costs).reduce((x, y) => x + y, 0) : 0
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        Scored at {hhmm(trace.t)} with the estimate at {pct(trace.confidence)}. Score = expected information gain
        (bits) − costs. Deterministic arithmetic from MediCue’s research engine, not language-model reasoning.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="border-b border-border pb-1 pr-2 font-medium">Action</th>
              <th scope="col" className="border-b border-border pb-1 pr-2 text-right font-medium">Info gain</th>
              <th scope="col" className="border-b border-border pb-1 pr-2 text-right font-medium">Costs</th>
              <th scope="col" className="border-b border-border pb-1 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {trace.ranked.map((a, i) => (
              <tr key={a.kind + (a.target ?? '')} className={i === 0 ? 'font-semibold' : ''}>
                <td className="border-b border-border py-1.5 pr-2">
                  {i === 0 && <span className="sr-only">Selected: </span>}
                  {a.kind}{a.target ? ` · ${a.label.replace(/^Ask /, '')}` : ''}
                  {i === 0 && <span className="ml-1.5 rounded bg-primary-soft px-1.5 text-xs text-primary">selected</span>}
                  {'clinician_reliability' in a.detail && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      reliability {Number(a.detail.clinician_reliability).toFixed(2)}{a.detail.note ? `, ${a.detail.note}` : ''}
                    </span>
                  )}
                  {'new_episodes' in a.detail && (
                    <span className="block text-xs font-normal text-muted-foreground">{a.detail.new_episodes} new episode(s) to check</span>
                  )}
                  {'expected_new_episodes_24h' in a.detail && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      about {a.detail.expected_new_episodes_24h} new episode(s) expected in 24 h
                    </span>
                  )}
                </td>
                <td className="border-b border-border py-1.5 pr-2 text-right font-mono tabular-nums">{a.eig.toFixed(2)}</td>
                <td className="border-b border-border py-1.5 pr-2 text-right font-mono tabular-nums">
                  {Object.values(a.costs).reduce((x, y) => x + y, 0).toFixed(2)}
                  <span className="block font-sans text-xs font-normal text-muted-foreground">
                    {Object.entries(a.costs).map(([k, v]) => `${COST_WORDS[k] ?? k} ${v.toFixed(2)}`).join(' · ')}
                  </span>
                </td>
                <td className="border-b border-border py-1.5 text-right font-mono tabular-nums">{a.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {best && (
        <p>
          Chose <strong>{trace.selected_label}</strong> ({ACTION_WORDS[best.kind] ?? best.kind}): highest score,{' '}
          {best.eig.toFixed(2)} bits of expected information for {bestCost.toFixed(2)} in costs
          {trace.ranked[1] && `, ahead of ${trace.ranked[1].kind} at ${trace.ranked[1].score.toFixed(2)}`}.
        </p>
      )}
    </div>
  )
}

function Context({ h }: { h: ResearchHypothesis }) {
  const eff = h.prior_effect
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
      {h.observation_text && (
        <>
          <dt className="text-muted-foreground">Observation</dt>
          <dd><blockquote className="italic">“{h.observation_text}”</blockquote></dd>
        </>
      )}
      <dt className="text-muted-foreground">Origin</dt>
      <dd>{h.origin === 'clinician' ? 'Clinician observation' : 'System detected'}: {h.origin_detail}</dd>
      {h.discovery && (<><dt className="text-muted-foreground">How it was found</dt><dd>{h.discovery}</dd></>)}
      <dt className="text-muted-foreground">Patient or cohort</dt>
      <dd>{h.cohort}</dd>
      <dt className="text-muted-foreground">Claim tested</dt>
      <dd>{h.claim}</dd>
      <dt className="text-muted-foreground">Created</dt>
      <dd>{dayHhmm(h.created_at)}</dd>
      <dt className="text-muted-foreground">Status</dt>
      <dd>{stageOf(h).label}</dd>
      {h.rationale && (
        <>
          <dt className="text-muted-foreground">Possible reason</dt>
          <dd>{h.rationale}{h.rationale_source === 'gemini' && <span className="text-muted-foreground"> (drafted by Gemini)</span>}</dd>
        </>
      )}
      {eff && (
        <>
          <dt className="text-muted-foreground">{h.status === 'VALIDATED' ? 'Now applied' : 'If validated'}</dt>
          <dd>
            {eff.need_ids.map(needLabel).join(', ')} made {eff.multiplier}× more likely
            {eff.after_visit_h ? ` for ${eff.after_visit_h} h after a family visit ends` : ''}
            {eff.hours ? ` from ${eff.hours[0]}:00 to ${eff.hours[eff.hours.length - 1] + 1}:00` : ''}
          </dd>
        </>
      )}
      {h.reviewer && (
        <>
          <dt className="text-muted-foreground">Review</dt>
          <dd>{h.reviewer}{h.reviewed_at ? `, ${dayHhmm(h.reviewed_at)}` : ''}{h.note ? `: “${h.note}”` : ''}</dd>
        </>
      )}
      {!h.test && (
        <>
          <dt className="text-muted-foreground">Data test</dt>
          <dd className="inline-flex items-center gap-1 text-muted-foreground">
            <CircleDashed className="size-4" aria-hidden="true" /> None: this can only be checked by asking clinicians.
          </dd>
        </>
      )}
    </dl>
  )
}
