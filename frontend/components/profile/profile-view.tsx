'use client'

import { ArrowLeft, Languages, TriangleAlert, Users } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LANGUAGE_NAME } from '@/lib/languages'
import { usePatientProfile } from '@/lib/live/profile'
import { timeAgo } from '@/lib/services/backend'
import { LearningPanel } from './learning-panel'
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

  const flags = Object.values(patient.chart).filter((c) => c.flag)
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
      <Link href="/home" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All patients
      </Link>

      <header className="flex flex-col gap-5 rounded-3xl border-2 border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-xl font-bold text-primary" aria-hidden="true">
            {patient.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-3xl font-bold">
              {patient.name} <span className="text-lg font-normal text-muted-foreground">{patient.age}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="rounded-md bg-muted px-1.5 font-mono font-medium text-foreground">{patient.room}</span>
              <span className="inline-flex items-center gap-1">
                <Languages className="size-3.5" aria-hidden="true" />
                {LANGUAGE_NAME[patient.language] ?? patient.language}
              </span>
              {patient.days_since_surgery != null && <span>Post-op day {patient.days_since_surgery}</span>}
            </div>
            <p className="text-base leading-relaxed text-muted-foreground">{patient.diagnosis}</p>
          </div>
        </div>
        {(flags.length > 0 || patient.people.length > 0) && (
          <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            {flags.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chart flags</span>
                <ul className="flex flex-wrap gap-2">
                  {flags.map((f) => (
                    <li key={f.value} className="inline-flex items-center gap-1.5 rounded-full bg-caution-soft px-3 py-1 text-sm font-medium">
                      <TriangleAlert className="size-3.5 text-caution" aria-hidden="true" />
                      {f.value}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {patient.people.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trusted contacts</span>
                <ul className="flex flex-wrap gap-2">
                  {patient.people.map((person) => (
                    <li key={person.id}>
                      <Link href={`/family/${person.id}`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-semibold hover:border-primary/40">
                        <Users className="size-3.5" aria-hidden="true" />
                        {person.name}, {person.relation}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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

      <LearningPanel patientId={patient.id} firstName={patient.name.split(' ')[0]} />
    </div>
  )
}
