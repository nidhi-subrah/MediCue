'use client'

import { ChevronsRight, MessageCircleQuestion } from 'lucide-react'

/** Shown while the engine is asking someone who knows the patient well, in place of a
 *  question — same highlighted-card language v0 used for "your helper asks", just framed
 *  for the real waiting_consult status instead of a free-form helper question. */
export function ConsultBanner({
  personName,
  relation,
  onSkip,
}: {
  personName: string
  relation: string
  onSkip: () => void
}) {
  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-4 rounded-3xl border-2 border-primary bg-primary-soft p-6 md:p-8"
    >
      <div className="flex items-start gap-3">
        <MessageCircleQuestion className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-wide text-primary">Asking someone who knows you</span>
          <p className="text-2xl font-bold leading-snug text-balance">
            We&apos;ve asked {personName} ({relation}) to help.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="min-tap inline-flex items-center justify-center gap-2 self-start rounded-xl border-2 border-border bg-card px-5 text-lg font-semibold hover:bg-muted"
      >
        <ChevronsRight className="size-5" aria-hidden="true" />
        Keep going myself
      </button>
    </section>
  )
}
