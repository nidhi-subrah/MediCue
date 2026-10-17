'use client'

import { HandHelping } from 'lucide-react'
import type { LadderState } from '@/lib/types'

/** Ladder level 4 (Assisted): ask whoever is nearby to help. The question below stays answerable, and the
 *  silence timer keeps running (shorter at this level), so a nurse is called if nobody answers. */
export function AssistCard({ assist }: { assist: LadderState['assist'] }) {
  return (
    <section
      aria-labelledby="assist-h"
      className="flex flex-col gap-3 rounded-3xl border-2 border-primary/40 bg-primary-soft p-6 md:flex-row md:items-center md:gap-5"
    >
      <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <HandHelping className="size-8" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 id="assist-h" className="text-3xl font-bold text-balance">
          Please show this screen to someone nearby
        </h2>
        <p className="text-lg leading-relaxed text-muted-foreground">
          They can help answer the question below.
          {assist && (
            <>
              {' '}
              We&apos;ve also asked {assist.person_name} ({assist.relation})
              {assist.status === 'answered' ? ', who has replied.' : ' for help.'}
            </>
          )}{' '}
          If nobody answers, a nurse will come.
        </p>
      </div>
    </section>
  )
}
