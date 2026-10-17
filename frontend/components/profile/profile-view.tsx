'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePatientProfile } from '@/lib/live/profile'
import { timeAgo } from '@/lib/services/backend'
import { ProfileList } from './profile-list'

/** A patient's chart notes and the profile Gemini read from them, with the quote behind every item. */
export function ProfileView({ patientId }: { patientId: string }) {
  const { patient, profile, error, saveNotes } = usePatientProfile(patientId)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Start the editor from the saved notes once they arrive (and again if another device saves).
  useEffect(() => {
    if (profile) setNotes(profile.notes)
  }, [profile?.notes]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !patient) {
    return <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-5 text-base text-urgent">{error}</p>
  }
  if (!patient || !profile) return <p className="text-base text-muted-foreground">Loading…</p>

  const changed = notes.trim() !== profile.notes.trim()
  const reading = saving || profile.extracting

  const save = async () => {
    setSaving(true)
    try {
      await saveNotes(notes)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{patient.name}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{patient.room}</span> · {patient.diagnosis}
          </p>
        </div>
        <Link href={`/talk/${patient.id}`} className="text-base font-semibold text-primary underline-offset-4 hover:underline">
          Open bedside tablet
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="notes-h" className="flex flex-col gap-3">
          <h2 id="notes-h" className="text-xl font-bold">Chart notes</h2>
          <textarea
            aria-label="Chart notes"
            rows={8}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-2xl border-2 border-input bg-background p-3 text-base leading-relaxed"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!changed || reading || !notes.trim()}
              className="min-tap inline-flex items-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {reading ? 'Reading notes…' : 'Save and re-read'}
            </button>
            {changed && !reading && (
              <button
                type="button"
                onClick={() => setNotes(profile.notes)}
                className="min-tap inline-flex items-center rounded-xl px-4 text-base font-semibold text-muted-foreground hover:bg-muted"
              >
                Undo
              </button>
            )}
          </div>
          {error && <p className="text-sm text-urgent">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Gemini reads these notes into the profile. Every item must quote the notes word for word, effects are
            capped, and high-risk needs can never be made less likely.
          </p>
        </section>

        <section aria-labelledby="profile-h" className="flex flex-col gap-3">
          <h2 id="profile-h" className="text-xl font-bold">Profile</h2>
          <p className="text-sm text-muted-foreground">
            {profile.source === 'gemini' ? 'Read by Gemini' : 'Gemini off: no profile from notes'}
            {profile.updated_at && ` · ${timeAgo(profile.updated_at)}`}
          </p>
          <div className="rounded-3xl border border-border bg-card p-5">
            <ProfileList items={profile.items} empty="Nothing in the notes changes how the engine behaves." />
          </div>
          {profile.dropped.length > 0 && (
            <details className="text-sm">
              <summary className="w-fit cursor-pointer text-primary">Not used ({profile.dropped.length})</summary>
              <ul className="mt-2 flex flex-col gap-1.5 pl-1">
                {profile.dropped.map((d, i) => (
                  <li key={i}>
                    <q className="italic">{d.evidence}</q> <span className="text-muted-foreground">{d.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  )
}
