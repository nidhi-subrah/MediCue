'use client'

import { BellRing } from 'lucide-react'
import { useState } from 'react'
import { answerCheck } from '@/lib/live/risk'
import { timeAgo } from '@/lib/services/backend'
import type { SilenceLadder } from '@/lib/types'

/** Shown to the trusted contact when an inactivity check reaches them. Their answer is the explicit
 *  acknowledgement for this step: "okay" closes the check, "worried" alerts the nurse straight away. */
export function SilenceCheckCard({ ladder, personId, onChange }: {
  ladder: SilenceLadder; personId: string; onChange: (l: SilenceLadder) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = ladder.patient_name.split(' ')[0]
  const mine = ladder.steps.find((s) => s.kind === 'contact')

  const answer = async (outcome: 'ok' | 'concern') => {
    setBusy(true)
    setError(null)
    try {
      onChange(await answerCheck(ladder.id, personId, outcome))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-live="assertive" className="flex flex-col gap-4 rounded-3xl border-2 border-caution bg-caution-soft p-5 md:p-8">
      <div className="flex items-start gap-3">
        <BellRing className="mt-1 size-6 shrink-0 text-caution" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-wide text-caution">
            Inactivity check · started {timeAgo(ladder.started_at)}
          </span>
          <p className="text-2xl font-bold leading-snug text-balance">
            {first} hasn&apos;t used their tablet for longer than usual and didn&apos;t answer a check on it. Can you check on {first}?
          </p>
          <p className="text-sm text-muted-foreground">{ladder.reason}</p>
        </div>
      </div>
      {mine?.status === 'acknowledged' ? (
        <p className="text-lg font-semibold" aria-live="polite">
          {mine.outcome === 'concern' ? 'Thank you. Their nurse has been alerted.' : 'Thank you, noted.'}
          {ladder.current === 'nurse' && ' Their nurse will check in person.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={() => answer('ok')}
                  className="min-tap rounded-xl border-2 border-border bg-card px-4 text-lg font-semibold hover:border-primary disabled:opacity-50">
            I&apos;ve checked: {first} is okay
          </button>
          <button type="button" disabled={busy} onClick={() => answer('concern')}
                  className="min-tap rounded-xl border-2 border-urgent bg-card px-4 text-lg font-semibold text-urgent disabled:opacity-50">
            I&apos;m worried: alert the nurse
          </button>
        </div>
      )}
      {error && <p className="text-sm text-urgent">{error}</p>}
    </section>
  )
}
