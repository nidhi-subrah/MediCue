'use client'

import { CircleHelp, Clock, HeartHandshake, MessageCircleQuestion } from 'lucide-react'
import { useFamilyData } from '@/lib/live/family'
import { timeAgo } from '@/lib/services/backend'
import { cn } from '@/lib/utils'

export function FamilyView({ personId }: { personId: string }) {
  const { me, consults, welfare, error, answer, checkIn } = useFamilyData(personId)

  if (error) {
    return <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-6 text-lg text-urgent">{error}</p>
  }
  if (!me) {
    return <p className="text-lg text-muted-foreground">Loading…</p>
  }

  const first = me.patient_name.split(' ')[0]
  const pending = consults.filter((c) => c.status === 'pending')
  const past = consults.filter((c) => c.status !== 'pending')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">For the person helping</p>
        <h1 className="text-3xl font-bold md:text-4xl">Hi {me.name.split(' ')[0]}</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">
          You&apos;re helping {first}&apos;s care team understand what {first} needs.
        </p>
      </header>

      {pending.length === 0 && (
        <p className="rounded-3xl border border-border bg-card p-6 text-lg leading-relaxed text-muted-foreground">
          No questions right now. If {first} is hard to understand, we&apos;ll ask you here.
        </p>
      )}

      {pending.map((c) => (
        <section
          key={c.id}
          aria-live="polite"
          className="flex flex-col gap-4 rounded-3xl border-2 border-primary bg-primary-soft p-5 md:p-8"
        >
          <div className="flex items-start gap-3">
            <MessageCircleQuestion className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-primary">
                {first}&apos;s care team is asking · {timeAgo(c.created_at)}
              </span>
              <p className="text-2xl font-bold leading-snug text-balance">{c.question}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {c.options.map((o) => (
              <button
                key={o.need}
                type="button"
                onClick={() => answer(c, o.need)}
                className="min-tap rounded-xl border-2 border-border bg-card px-4 text-lg font-semibold hover:border-primary"
              >
                {o.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => answer(c, null)}
              className="min-tap rounded-xl border-2 border-dashed border-border bg-surface px-4 text-lg font-semibold text-muted-foreground hover:border-primary/40"
            >
              Something else
            </button>
          </div>
          <button
            type="button"
            onClick={() => answer(c, null, true)}
            className="inline-flex h-10 items-center gap-1.5 self-start rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CircleHelp className="size-4" aria-hidden="true" />
            I&apos;m not sure
          </button>
        </section>
      ))}

      <section aria-labelledby="welfare" className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h2 id="welfare" className="text-xl font-bold">Worried about {first}?</h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            We&apos;ll ask {first} to tap their tablet. If there&apos;s no response in time, their nurse is alerted.
            This only notices a missed response; it can&apos;t tell why.
          </p>
        </div>
        <button
          type="button"
          onClick={checkIn}
          disabled={welfare?.status === 'pending'}
          className="min-tap inline-flex items-center justify-center gap-2 self-start rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
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
        <details className="rounded-3xl border border-border bg-card p-6">
          <summary className="cursor-pointer text-base font-bold">Earlier questions ({past.length})</summary>
          <ul className="mt-4 flex flex-col gap-2">
            {past.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3 text-base">
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
