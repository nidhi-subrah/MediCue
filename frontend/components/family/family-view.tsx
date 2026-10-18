'use client'

import { CircleHelp, Clock, HeartHandshake, MessageCircleQuestion } from 'lucide-react'
import { SilenceCheckCard } from '@/components/risk/silence-check-card'
import { useFamilyData } from '@/lib/live/family'
import { timeAgo } from '@/lib/services/backend'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'

export function FamilyView({ personId }: { personId: string }) {
  const { me, consults, welfare, error, answer, checkIn, checks, upsertCheck } = useFamilyData(personId)

  if (error) {
    return <p className="rounded-2xl border border-urgent/30 bg-urgent/5 p-6 text-lg text-urgent">{error}</p>
  }
  if (!me) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <p className="text-base text-muted-foreground">Loading…</p>
        </div>
      </div>
    )
  }

  const first = me.patient_name.split(' ')[0]
  const pending = consults.filter((c) => c.status === 'pending')
  const past = consults.filter((c) => c.status !== 'pending')

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="For the person helping"
        title={<>Hi {me.name.split(' ')[0]}</>}
        description={<>You&apos;re helping {first}&apos;s care team understand what {first} needs.</>}
      />

      {checks.filter((l) => l.active).map((l) => (
        <SilenceCheckCard key={l.id} ladder={l} personId={personId} onChange={upsertCheck} />
      ))}

      {pending.length === 0 && (
        <div className="patient-section text-lg leading-relaxed text-muted-foreground">
          No questions right now. If {first} is hard to understand, we&apos;ll ask you here.
        </div>
      )}

      {pending.map((c) => (
        <section
          key={c.id}
          aria-live="polite"
          className="patient-section flex flex-col gap-4 !border-primary/25 !bg-[oklch(0.97_0.015_262_/_0.7)]"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <MessageCircleQuestion className="size-5 text-primary" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <span className="eyebrow text-primary">
                {first}&apos;s care team is asking · {timeAgo(c.created_at)}
              </span>
              <p className="text-2xl font-semibold leading-snug text-balance">{c.question}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {c.options.map((o) => (
              <button
                key={o.need}
                type="button"
                onClick={() => answer(c, o.need)}
                className="min-tap rounded-xl border border-[oklch(0.92_0.008_260_/_0.5)] bg-[oklch(1_0_0_/_0.7)] px-4 text-lg font-semibold backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-[oklch(1_0_0_/_0.85)] hover:shadow-md active:scale-[0.97]"
              >
                {o.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => answer(c, null)}
              className="min-tap rounded-xl border border-dashed border-[oklch(0.9_0.008_260_/_0.5)] bg-[oklch(0.98_0.003_260_/_0.5)] px-4 text-lg font-semibold text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-[oklch(0.97_0.006_260_/_0.7)] active:scale-[0.97]"
            >
              Something else
            </button>
          </div>
          <button
            type="button"
            onClick={() => answer(c, null, true)}
            className="patient-btn min-h-10 self-start"
          >
            <CircleHelp className="size-4" aria-hidden="true" />
            I&apos;m not sure
          </button>
        </section>
      ))}

      <section aria-labelledby="welfare" className="patient-section flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="welfare" className="text-xl font-semibold">Worried about {first}?</h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            We&apos;ll ask {first} to tap their tablet. If there&apos;s no response in time, their nurse is alerted.
            This only notices a missed response; it can&apos;t tell why.
          </p>
        </div>
        <button
          type="button"
          onClick={checkIn}
          disabled={welfare?.status === 'pending'}
          className="min-tap inline-flex items-center justify-center gap-2 self-start rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground shadow-md shadow-primary/15 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 disabled:opacity-40 active:scale-[0.97]"
        >
          <HeartHandshake className="size-5" aria-hidden="true" />
          Check on {first}
        </button>
        {welfare && (
          <p
            role="status"
            className={cn(
              'inline-flex items-center gap-2 text-base font-semibold',
              welfare.status === 'responded' && 'text-success',
              welfare.status === 'no_response' && 'text-urgent',
            )}
          >
            <Clock className="size-4" aria-hidden="true" />
            {welfare.status === 'pending' && 'Waiting for a response…'}
            {welfare.status === 'responded' && `${first} responded.`}
            {welfare.status === 'no_response' && 'No response. Their nurse has been alerted.'}
          </p>
        )}
      </section>

      {past.length > 0 && (
        <details className="patient-section">
          <summary className="cursor-pointer text-base font-semibold">Earlier questions ({past.length})</summary>
          <ul className="mt-4 flex flex-col gap-2">
            {past.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-[oklch(0.98_0.003_260_/_0.5)] p-3 text-base">
                <span>{c.question}</span>
                <span className="text-sm text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
