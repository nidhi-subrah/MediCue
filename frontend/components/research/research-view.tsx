'use client'

import { FlaskConical } from 'lucide-react'
import { useResearch } from '@/lib/live/research'
import type { ResearchHypothesis } from '@/lib/types'
import { HypothesisCard } from './hypothesis-card'
import { InquiryCard } from './inquiry-card'
import { ObservationForm } from './observation-form'
import { PageHeader } from '@/components/app/page-header'

const PENDING = new Set(['SUPPORTED_PENDING_REVIEW', 'REJECTED_PENDING_REVIEW'])
const DONE = new Set(['VALIDATED', 'REJECTED'])

export function ResearchView() {
  const { hypotheses, inquiries, digest, staff, patients, running, runCycle, reviewHypothesis, answerInquiry, submitObservation } =
    useResearch()

  const pending = hypotheses.filter((h) => PENDING.has(h.status))
  // Clinician observations first (a person is waiting on them), then the most decided.
  const active = hypotheses
    .filter((h) => !PENDING.has(h.status) && !DONE.has(h.status))
    .sort(
      (a, b) =>
        Number(b.origin === 'clinician') - Number(a.origin === 'clinician') ||
        Math.abs(b.confidence - 0.5) - Math.abs(a.confidence - 0.5),
    )
  const done = hypotheses.filter((h) => DONE.has(h.status))

  const review = (h: ResearchHypothesis) => (decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) =>
    reviewHypothesis(h.id, decision, note)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pattern review · Research agent"
        title="Research"
        description={<>
          {pending.length} awaiting review · {active.length} under investigation · {inquiries.length} question
          {inquiries.length === 1 ? '' : 's'} for clinicians
        </>}
        actions={<button
          type="button"
          onClick={runCycle}
          disabled={running}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40"
        >
          <FlaskConical className="size-4" aria-hidden="true" />
          {running ? 'Running…' : 'Run research cycle'}
        </button>}
      />

      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
        Clinician observations and patterns found in confirmed requests become hypotheses. For each one the agent
        chooses to check the data, ask a clinician who knows the patient, or wait for more episodes, and updates its
        confidence from what it finds. Nothing is treated as a finding until the clinical lead reviews it.
      </p>

      {digest && (
        <section aria-label="Research digest" className="flex flex-col gap-1.5 rounded-2xl border border-primary/30 bg-primary-soft p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">This shift</p>
          <p className="text-lg leading-relaxed">{digest.text}</p>
          {digest.source === 'gemini' && <p className="text-xs text-muted-foreground">Phrased by Gemini from the counts</p>}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="pending-h" className="flex flex-col gap-4">
            <header className="flex items-baseline justify-between border-b border-border pb-2">
              <h2 id="pending-h" className="text-xl font-semibold">Pending review</h2>
              <span className="text-sm text-muted-foreground">{pending.length}</span>
            </header>
            {pending.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-base text-muted-foreground">
                Nothing has crossed a review threshold yet.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Human review is required before any hypothesis is treated as a finding.</p>
            )}
            {pending.map((h) => <HypothesisCard key={h.id} h={h} mode="review" onReview={review(h)} />)}
          </section>

          <section aria-labelledby="active-h" className="flex flex-col gap-4">
            <header className="flex items-baseline justify-between border-b border-border pb-2">
              <h2 id="active-h" className="text-xl font-semibold">Active hypotheses</h2>
              <span className="text-sm text-muted-foreground">{active.length}</span>
            </header>
            {active.length === 0 && (
              <p className="rounded-2xl border border-border bg-card p-6 text-base text-muted-foreground">
                No hypotheses under investigation.
              </p>
            )}
            {active.map((h) => <HypothesisCard key={h.id} h={h} mode="active" onReview={review(h)} />)}
          </section>

          <section aria-labelledby="history-h" className="flex flex-col gap-4">
            <header className="flex items-baseline justify-between border-b border-border pb-2">
              <h2 id="history-h" className="text-xl font-semibold">Validated and rejected</h2>
              <span className="text-sm text-muted-foreground">{done.length}</span>
            </header>
            {done.length === 0 && (
              <p className="rounded-2xl border border-border bg-card p-6 text-base text-muted-foreground">
                Nothing reviewed yet. Evidence and history stay here after review.
              </p>
            )}
            {done.map((h) => <HypothesisCard key={h.id} h={h} mode="history" onReview={review(h)} />)}
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section aria-labelledby="inq-h" className="flex flex-col gap-4">
            <header className="flex items-baseline justify-between border-b border-border pb-2">
              <h2 id="inq-h" className="text-xl font-semibold">Questions for clinicians</h2>
              <span className="text-sm text-muted-foreground">{inquiries.length}</span>
            </header>
            {inquiries.length === 0 && (
              <p className="rounded-2xl border border-border bg-card p-6 text-base text-muted-foreground">
                The agent has no open questions.
              </p>
            )}
            {inquiries.map((i) => (
              <InquiryCard key={i.id} inquiry={i} onAnswer={(response, note) => answerInquiry(i.id, response, note)} />
            ))}
          </section>

          <ObservationForm staff={staff} patients={patients} onSubmit={submitObservation} />
        </aside>
      </div>
    </div>
  )
}
