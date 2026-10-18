'use client'

import { ChevronsRight, MessageCircleQuestion } from 'lucide-react'

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
      className="patient-section flex flex-col gap-5 !border-primary/25 !bg-[oklch(0.97_0.015_262_/_0.7)]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <MessageCircleQuestion className="size-5 text-primary" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-primary">Asking someone who knows you</span>
          <p className="text-2xl font-semibold leading-snug text-balance">
            We&apos;ve asked {personName} ({relation}) to help.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="min-tap inline-flex items-center justify-center gap-2 self-start rounded-xl bg-[oklch(1_0_0_/_0.7)] px-5 text-lg font-semibold shadow-sm backdrop-blur-sm transition-all hover:bg-[oklch(1_0_0_/_0.9)] hover:shadow-md active:scale-[0.97]"
        style={{ border: '1px solid oklch(0.92 0.008 260 / 0.5)' }}
      >
        <ChevronsRight className="size-5" aria-hidden="true" />
        Keep going myself
      </button>
    </section>
  )
}
