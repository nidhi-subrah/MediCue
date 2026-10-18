'use client'

import { useState } from 'react'
import { timeAgo } from '@/lib/services/backend'
import type { ProfileSuggestion } from '@/lib/types'

const STATUS_NOTE: Partial<Record<ProfileSuggestion['status'], string>> = {
  duplicate: 'Already in the profile',
  blocked: 'Not allowed',
  approved: 'Approved',
  rejected: 'Rejected',
}

/** Profile changes Gemini suggested from nurses' notes. Nothing applies until a nurse approves it. */
export function SuggestionsPanel({
  items,
  onReview,
}: {
  items: ProfileSuggestion[]
  onReview: (id: string, approve: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  if (items.length === 0) return null
  const pending = items.filter((s) => s.status === 'pending')
  const recent = items.filter((s) => s.status !== 'pending').slice(0, 4)

  const review = async (id: string, approve: boolean) => {
    setBusy(id)
    try {
      await onReview(id, approve)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="sugg-h" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 id="sugg-h" className="text-xl font-bold">Profile suggestions</h2>
        <p className="text-sm text-muted-foreground">{pending.length} to review · from nurses&apos; notes</p>
      </header>
      {[...pending, ...recent].map((s) => (
        <article key={s.id} className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{s.room}</span> {s.patient_name} · {s.nurse}, {timeAgo(s.created_at)}
          </p>
          <p className="text-base font-semibold">{s.item.effect}</p>
          <q className="text-sm italic text-muted-foreground">{s.item.evidence}</q>
          {s.status === 'pending' ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => review(s.id, true)}
                className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => review(s.id, false)}
                className="min-h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {STATUS_NOTE[s.status]}
              {s.reason && s.status !== 'duplicate' ? `: ${s.reason}` : ''}
            </p>
          )}
        </article>
      ))}
    </section>
  )
}
