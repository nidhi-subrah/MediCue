'use client'

import { useState } from 'react'
import { timeAgo } from '@/lib/services/backend'
import type { ResearchInquiry } from '@/lib/types'

/** A question the agent sent a clinician. Agree / Disagree / Unsure, optional note. The answer becomes evidence
 *  on the hypothesis through the backend; nothing is shown as saved until the server confirms it. */
export function InquiryCard({
  inquiry,
  regarding,
  onAnswer,
  onSaved,
}: {
  inquiry: ResearchInquiry
  regarding: string
  onAnswer: (response: 'agree' | 'disagree' | 'unsure', note: string | null) => Promise<unknown>
  /** Called once the server has saved the answer (the card then leaves the list, so the page confirms it). */
  onSaved: (message: string) => void
}) {
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const answer = async (response: 'agree' | 'disagree' | 'unsure') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onAnswer(response, note.trim() || null)
      onSaved(`Answer saved: ${inquiry.clinician_name} answered “${response}” about ${regarding}. It is now evidence on the hypothesis.`)
    } catch (e) {
      setError(`Couldn't save the answer. ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article aria-label={`Question for ${inquiry.clinician_name} about ${regarding}`}
             className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">For</dt>
        <dd className="font-semibold">{inquiry.clinician_name}, {inquiry.clinician_role}</dd>
        <dt className="text-muted-foreground">Regarding</dt>
        <dd>{regarding} <span className="text-muted-foreground">· asked {timeAgo(inquiry.created_at)}</span></dd>
      </dl>
      <p className="text-base font-semibold leading-snug">{inquiry.question}</p>
      {noteOpen ? (
        <input aria-label="Note with your answer (optional)" placeholder="Add a note (optional)" value={note} disabled={busy}
               onChange={(e) => setNote(e.target.value)} autoFocus
               className="min-h-11 rounded-xl border border-input bg-background px-3 text-base" />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {(['agree', 'disagree', 'unsure'] as const).map((r, i) => (
          <button key={r} type="button" disabled={busy} onClick={() => answer(r)}
                  className={i === 0
                    ? 'min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold capitalize text-primary-foreground hover:bg-primary/90 disabled:opacity-40'
                    : 'min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold capitalize hover:bg-muted disabled:opacity-40'}>
            {r}
          </button>
        ))}
        {!noteOpen && (
          <button type="button" onClick={() => setNoteOpen(true)} disabled={busy}
                  className="min-h-11 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-muted">
            Add note
          </button>
        )}
        {busy && <span className="text-sm text-muted-foreground" aria-live="polite">Saving…</span>}
      </div>
      {error && <p role="alert" className="text-sm text-urgent">{error}</p>}
    </article>
  )
}
