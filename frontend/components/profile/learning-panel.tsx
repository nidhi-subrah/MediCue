'use client'

import { useState } from 'react'
import { catalog } from '@/lib/live/catalog'
import { usePatientLearning } from '@/lib/live/profile'
import { pct } from '@/lib/services/backend'
import { cn } from '@/lib/utils'

/** "The system learns the patient": gestures that came to mean something specific for this patient,
 *  and a replay of how quickly one gesture gets understood as nurses confirm it. */
export function LearningPanel({ patientId, firstName }: { patientId: string; firstName: string }) {
  const { learning, demo, running, error, runDemo } = usePatientLearning(patientId)
  const [area, setArea] = useState('whole_body')
  const [feeling, setFeeling] = useState('scared')
  const [need, setNeed] = useState('too_cold')
  const maxInputs = demo ? Math.max(...demo.sessions.map((s) => s.inputs)) : 1
  const first = demo?.sessions[0]
  const last = demo?.sessions[demo.sessions.length - 1]

  return (
    <section aria-labelledby="learn-h" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 id="learn-h" className="text-xl font-bold">Learned from confirmations</h2>
        <p className="text-sm text-muted-foreground">
          Each time a nurse confirms what {firstName} needed, MediCue remembers the taps that led there and reads
          them that way next time. Learning only changes the interpretation. The urgent-escalation check always reads
          taps the standard way.
        </p>
      </header>

      <div className="rounded-3xl border border-border bg-card p-5">
        {learning && learning.signals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing learned yet{learning.confirmations ? ` (${learning.confirmations} confirmation${learning.confirmations === 1 ? '' : 's'} so far)` : ''}.
            A gesture shows up here after two matching confirmations.
          </p>
        )}
        {learning && learning.signals.length > 0 && (
          <ul className="flex flex-col gap-3">
            {learning.signals.map((s) => (
              <li key={`${s.area}-${s.feeling}`} className="flex flex-col gap-0.5 border-l-4 border-primary/40 pl-3">
                <span className="text-base font-semibold">
                  {s.area_label} + {s.feeling_label} → {s.need_label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {s.count} of {s.of} confirmation{s.of === 1 ? '' : 's'}
                  {s.personal && ` · most patients mean ${s.usual_label.toLowerCase()} by this`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!learning && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
        <h3 className="text-base font-bold">Replay: how fast does a gesture get understood?</h3>
        <p className="text-sm text-muted-foreground">
          Runs the real engine in memory for five sessions, starting from nothing learned. {firstName} taps the gesture
          and answers truthfully; after each session a nurse confirms the need. Nothing is saved.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Taps
            <select value={area} onChange={(e) => setArea(e.target.value)} className="h-11 rounded-xl border-2 border-input bg-background px-3 text-base text-foreground">
              {catalog.areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <span className="pb-2.5 text-base">+</span>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            <span className="sr-only">Feeling</span>&nbsp;
            <select value={feeling} onChange={(e) => setFeeling(e.target.value)} aria-label="Feeling" className="h-11 rounded-xl border-2 border-input bg-background px-3 text-base text-foreground">
              {catalog.feelings.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            to mean
            <select value={need} onChange={(e) => setNeed(e.target.value)} className="h-11 rounded-xl border-2 border-input bg-background px-3 text-base text-foreground">
              {catalog.needs.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={running}
            onClick={() => runDemo(area, feeling, need, 5)}
            className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {running ? 'Replaying…' : 'Replay 5 sessions'}
          </button>
        </div>
        {error && <p className="text-sm text-urgent">{error}</p>}

        {demo && first && last && (
          <div className="flex flex-col gap-3 pt-1">
            <p className="text-base">
              <strong>
                {first.inputs} interactions → {last.inputs}
              </strong>
              {first.first_guess !== demo.need && last.first_guess === demo.need && (
                <>. The first time, the gesture read as {first.first_guess_label.toLowerCase()}; by session {last.session} it reads as {demo.need_label.toLowerCase()} straight away.</>
              )}
              {demo.high_risk && <> {demo.need_label} is high-risk, so it escalates at once every time.</>}
            </p>
            <ol className="flex flex-col gap-2" aria-label="Patient interactions per session">
              {demo.sessions.map((s) => (
                <li key={s.session} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Session {s.session}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      className="h-3 rounded-sm bg-primary"
                      style={{ width: `${Math.max((s.inputs / maxInputs) * 9, 0.75)}rem` }}
                      aria-hidden="true"
                    />
                    <span className="font-mono tabular-nums">
                      {s.inputs} input{s.inputs === 1 ? '' : 's'}
                    </span>
                    <span className={cn('text-muted-foreground', s.first_guess === demo.need && 'text-foreground')}>
                      read as {s.first_guess_label} {pct(s.first_guess_p)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">
              Inputs = taps plus yes/no answers. &ldquo;Read as&rdquo; is the engine&apos;s best guess right after the gesture, before any question.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
