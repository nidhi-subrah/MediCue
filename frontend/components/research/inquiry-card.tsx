'use client'

import { useState } from 'react'
import { timeAgo } from '@/lib/services/backend'
import type { ResearchInquiry } from '@/lib/types'

export function InquiryCard({
  inquiry,
  onAnswer,
}: {
  inquiry: ResearchInquiry
  onAnswer: (response: 'agree' | 'disagree' | 'unsure', note: string | null) => Promise<unknown>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const answer = async (response: 'agree' | 'disagree' | 'unsure') => {
    setBusy(true)
    try {
      await onAnswer(response, note || null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article aria-label={`Question for ${inquiry.clinician_name}`} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">For {inquiry.clinician_name}</span>
        <span>{inquiry.clinician_role}</span>
        <span>{timeAgo(inquiry.created_at)}</span>
      </p>
      <p className="text-lg font-semibold">{inquiry.question}</p>
      <input
        aria-label="Optional note"
        placeholder="Add a note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-11 rounded-xl border border-input bg-background px-3 text-base"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => answer('agree')}
          className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          Agree
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer('disagree')}
          className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-40"
        >
          Disagree
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer('unsure')}
          className="min-h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          Unsure
        </button>
      </div>
    </article>
  )
}
