'use client'

import { HandHelping } from 'lucide-react'
import type { CommunicationState } from '@/lib/types'

export function AssistCard({ comm }: { comm: CommunicationState }) {
  const { summary, assist } = comm
  return (
    <section aria-labelledby="assist-h" className="patient-section flex flex-col gap-5 !border-primary/25 !bg-[oklch(0.97_0.015_262_/_0.7)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-5">
        <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.28_0.07_259)] text-primary-foreground shadow-lg shadow-primary/15">
          <HandHelping className="size-8" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 id="assist-h" className="text-3xl font-semibold text-balance">
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
      <div className="grid gap-4 border-t border-[oklch(0.92_0.01_260_/_0.4)] pt-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Already confirmed</h3>
          {summary.confirmed.length ? (
            <ul className="flex flex-col gap-1.5 text-lg">
              {summary.confirmed.map((c) => (
                <li key={c.field} className="flex items-baseline gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
                  <span className="text-muted-foreground">{c.field}:</span> <strong>{c.value}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="text-lg text-muted-foreground">Nothing yet.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Still to find out</h3>
          <ul className="flex flex-col gap-1.5 text-lg">
            {summary.unresolved.map((u) => (
              <li key={u.field} className="flex items-baseline gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" />
                {u.field}{u.value ? ` (${u.value})` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
