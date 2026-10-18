'use client'

import { CircleCheck, FlaskConical, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { type CycleResult, useResearch } from '@/lib/live/research'
import type { ResearchHypothesis, ResearchInquiry } from '@/lib/types'
import { cn } from '@/lib/utils'
import { HypothesisCard, PENDING_REVIEW } from './hypothesis-card'
import { InquiryCard } from './inquiry-card'
import { ObservationButton } from './observation-form'

const DONE = new Set(['VALIDATED', 'REJECTED'])

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** What the last research cycle did, counted from the data before and after it. */
function CycleBanner({ result, onClose }: { result: CycleResult; onClose: () => void }) {
  if (!result.ok) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-urgent/40 bg-urgent-soft p-4">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-urgent" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold">The research cycle didn’t run.</p>
          <p className="text-sm text-muted-foreground">{result.error}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-primary">Dismiss</button>
      </div>
    )
  }
  const s = result.summary
  const lines = [
    s.created && `${plural(s.created, 'new hypothesis', 'new hypotheses')} proposed from the data`,
    s.investigated && `${plural(s.investigated, 'hypothesis', 'hypotheses')} investigated`,
    s.dataChecks && `${plural(s.dataChecks, 'database check')} performed`,
    s.inquiries && `${plural(s.inquiries, 'clinician question')} sent`,
    s.confidenceUpdates && `${plural(s.confidenceUpdates, 'estimate')} updated`,
    s.statusChanges && `${plural(s.statusChanges, 'status change')}`,
    s.waits && `${plural(s.waits, 'hypothesis', 'hypotheses')} set to wait for more episodes`,
  ].filter(Boolean) as string[]
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success-soft p-4">
      <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">
          Research cycle completed{lines.length ? '.' : '. No new evidence or actions were available.'}
        </p>
        {lines.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        )}
      </div>
      <button type="button" onClick={onClose} className="text-sm font-semibold text-primary">Dismiss</button>
    </div>
  )
}

function Metric({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card px-4 py-3">
      <span className={cn('text-2xl font-bold tabular-nums', tone)}>{n}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border bg-card p-5 text-base text-muted-foreground">{children}</p>
}

function GroupHeader({ id, title, count, hint }: { id: string; title: string; count: number; hint?: string }) {
  return (
    <header className="flex flex-col gap-0.5">
      <h3 id={id} className="flex items-baseline gap-2 text-lg font-bold">
        {title} <span className="text-sm font-normal text-muted-foreground">{count}</span>
      </h3>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </header>
  )
}

export function ResearchView() {
  const { hypotheses, inquiries, digest, staff, patients, loading, error, running, runCycle, reviewHypothesis,
          answerInquiry, submitObservation } = useResearch()
  const [cycle, setCycle] = useState<CycleResult | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  const byId = new Map(hypotheses.map((h) => [h.id, h]))
  const inquiryFor = new Map(inquiries.map((i) => [i.hypothesis_id, i]))
  const pending = hypotheses.filter((h) => PENDING_REVIEW.has(h.status))
  // Clinician observations first (a person is waiting on them), then the most decided.
  const active = hypotheses
    .filter((h) => !PENDING_REVIEW.has(h.status) && !DONE.has(h.status))
    .sort((a, b) => Number(b.origin === 'clinician') - Number(a.origin === 'clinician') ||
                    Math.abs(b.confidence - 0.5) - Math.abs(a.confidence - 0.5))
  const done = hypotheses.filter((h) => DONE.has(h.status))
  const validated = hypotheses.filter((h) => h.status === 'VALIDATED').length

  // Questions to the same clinician about the same patient sit together; each stays its own question.
  const regarding = (i: ResearchInquiry) => byId.get(i.hypothesis_id)?.cohort ?? 'Unknown patient'
  const groups = new Map<string, ResearchInquiry[]>()
  for (const i of inquiries) {
    const key = `${i.clinician_id}|${regarding(i)}`
    groups.set(key, [...(groups.get(key) ?? []), i])
  }

  const review = (h: ResearchHypothesis) => (decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) =>
    reviewHypothesis(h.id, decision, note)

  const run = async () => {
    setCycle(null)
    const r = await runCycle()
    if (r) setCycle(r)
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-4xl font-bold tracking-tight">Research Agent</h1>
          <p className="text-lg text-muted-foreground">Investigating patient communication patterns with clinical oversight.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ObservationButton staff={staff} patients={patients} onSubmit={submitObservation} onAdded={setAdded} />
          <button type="button" onClick={run} disabled={running} aria-busy={running}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="size-4" aria-hidden="true" />}
            {running ? 'Running research cycle…' : 'Run research cycle'}
          </button>
        </div>
      </header>

      <div aria-live="polite" className="flex flex-col gap-3">
        {cycle && <CycleBanner result={cycle} onClose={() => setCycle(null)} />}
        {added && (
          <p role="status" className="flex items-start gap-2 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span className="flex-1">{added}</span>
            <button type="button" onClick={() => setAdded(null)} className="font-semibold text-primary">Dismiss</button>
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-2xl border border-urgent/40 bg-urgent-soft p-4 text-sm">
            Couldn’t load the research data. {error}
          </p>
        )}
      </div>

      <section aria-label="Research overview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric n={active.length} label="Active investigations" />
        <Metric n={inquiries.length} label="Awaiting clinician input" />
        <Metric n={pending.length} label="Pending validation" tone={pending.length ? 'text-caution' : undefined} />
        <Metric n={validated} label="Validated findings" tone={validated ? 'text-success' : undefined} />
      </section>

      {digest && (
        <section aria-label="Research digest" className="rounded-2xl border border-border bg-surface px-5 py-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">This shift</p>
          <p className="mt-1 text-base leading-relaxed">{digest.text}</p>
          {digest.source === 'gemini' && <p className="mt-1 text-xs text-muted-foreground">Phrased by Gemini from the counts above</p>}
        </section>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading research…</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Everything waiting on a person comes first: on the left, and before the investigations on tablets
              (stacked) instead of after all of them. */}
          <section aria-labelledby="input-h" className="flex min-w-0 flex-col gap-6">
            <h2 id="input-h" className="border-b border-border pb-2 text-xl font-bold">Needs a clinician</h2>

            <div className="flex flex-col gap-3" aria-labelledby="pending-h">
              <GroupHeader id="pending-h" title="Pending validation" count={pending.length}
                           hint={pending.length ? 'The estimate crossed a review threshold. Nothing is a finding until a clinical lead decides.' : undefined} />
              {pending.length === 0 ? <Empty>Nothing is waiting for review.</Empty>
                : pending.map((h) => <HypothesisCard key={h.id} h={h} inquiry={inquiryFor.get(h.id)} onReview={review(h)} />)}
            </div>

            <div className="flex flex-col gap-3" aria-labelledby="q-h">
              <GroupHeader id="q-h" title="Questions awaiting answers" count={inquiries.length}
                           hint={inquiries.length ? 'Each answer becomes evidence on the hypothesis it is about.' : undefined} />
              {inquiries.length === 0 ? <Empty>The agent has no open questions for clinicians.</Empty>
                : [...groups.values()].map((g) => (
                  <div key={g[0].id} className={cn('flex flex-col gap-2', g.length > 1 && 'rounded-2xl border border-border bg-surface p-2')}>
                    {g.length > 1 && (
                      <p className="px-2 pt-1 text-sm font-semibold">
                        {g.length} questions for {g[0].clinician_name} about {regarding(g[0])}
                      </p>
                    )}
                    {g.map((i) => (
                      <InquiryCard key={i.id} inquiry={i} regarding={regarding(i)} onSaved={setAdded}
                                   onAnswer={(response, note) => answerInquiry(i.id, response, note)} />
                    ))}
                  </div>
                ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Noticed something yourself? Use <strong>Add observation</strong> at the top: it becomes a hypothesis
              the agent investigates.
            </p>
          </section>

          <section aria-labelledby="inv-h" className="flex min-w-0 flex-col gap-6">
            <h2 id="inv-h" className="border-b border-border pb-2 text-xl font-bold">Investigations</h2>

            <div className="flex flex-col gap-3" aria-labelledby="active-h">
              <GroupHeader id="active-h" title="Active investigations" count={active.length} />
              {active.length === 0 ? <Empty>No hypotheses are under investigation. Run a research cycle or add an observation.</Empty>
                : active.map((h) => <HypothesisCard key={h.id} h={h} inquiry={inquiryFor.get(h.id)} onReview={review(h)} />)}
            </div>

            <div className="flex flex-col gap-3" aria-labelledby="done-h">
              <GroupHeader id="done-h" title="Validated and rejected" count={done.length} />
              {done.length === 0 ? <Empty>Nothing reviewed yet. Reviewed hypotheses keep their evidence and history here.</Empty> : (
                <>
                  <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}
                          className="self-start text-sm font-semibold text-primary underline-offset-4 hover:underline">
                    {showDone ? 'Hide reviewed hypotheses' : `Show ${plural(done.length, 'reviewed hypothesis', 'reviewed hypotheses')}`}
                  </button>
                  {showDone && done.map((h) => <HypothesisCard key={h.id} h={h} onReview={review(h)} />)}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
