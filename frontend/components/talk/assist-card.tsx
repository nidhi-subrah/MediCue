'use client'

import { HandHelping } from 'lucide-react'
import type { CommunicationState } from '@/lib/types'

/** Assisted communication: someone helps. Shows what is already confirmed and what is still open, so the
 *  helper starts from what the patient has said and nothing they didn't say is filled in. The question below
 *  stays answerable, and the silence timer keeps running (shorter in this mode). */
export function AssistCard({ comm }: { comm: CommunicationState }) {
  const { summary, assist } = comm
  return (
    <section aria-labelledby="assist-h" className="flex flex-col gap-4 rounded-3xl border-2 border-primary/40 bg-primary-soft p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
        <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <HandHelping className="size-8" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="assist-h" className="text-3xl font-bold text-balance">
            {assist?.help === 'nurse_present' ? 'A nurse is helping you communicate' : 'Someone is coming to help you communicate'}
          </h2>
          <p className="text-lg leading-relaxed text-muted-foreground">
            {assist?.help === 'caregiver' && assist.person_name
              ? `We've asked ${assist.person_name} (${assist.relation}). `
              : assist?.help === 'nurse' ? 'A nurse has been asked to come. ' : ''}
            Everything you've told us so far is kept.
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Already confirmed</h3>
          {summary.confirmed.length ? (
            <ul className="mt-1 flex flex-col gap-1 text-lg">
              {summary.confirmed.map((c) => <li key={c.field}><span className="text-muted-foreground">{c.field}:</span> <strong>{c.value}</strong></li>)}
            </ul>
          ) : <p className="mt-1 text-lg text-muted-foreground">Nothing yet.</p>}
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Still to find out</h3>
          <ul className="mt-1 flex flex-col gap-1 text-lg">
            {summary.unresolved.map((u) => <li key={u.field}>{u.field}{u.value ? ` (${u.value})` : ''}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
