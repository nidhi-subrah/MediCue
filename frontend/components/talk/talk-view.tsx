'use client'

import { CircleCheckBig, LogOut, Siren, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/app/auth-provider'
import { useLiveSession } from '@/lib/live/session'
import { buildStep, uiMode } from '@/lib/live/talk-adapter'
import { useSettings } from '@/lib/store/settings'
import { cn } from '@/lib/utils'
import { AssistCard } from './assist-card'
import { ConsultBanner } from './consult-banner'
import { LevelBar, LevelTransition } from './level-bar'
import { QuestionStage } from './question-stage'
import { SummaryPanel } from './summary-panel'

export function TalkView() {
  const { patient, session, error, busy, welfare, welfareSecondsLeft, tap, answerQuestion, skipConsult, goBack, respondWelfare,
    signal, setLevel } = useLiveSession()
  const { user, logout } = useAuth()
  const audio = useSettings((s) => s.spokenPrompts)
  const updateSettings = useSettings((s) => s.update)
  const [showEngine, setShowEngine] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)   // "Something else" on the tailored second step
  const stepKey = session ? `${session.session_id}-${session.status}-${session.taps}-${session.ladder.level}` : ''
  useEffect(() => setMoreOpen(false), [stepKey])

  if (error && !session) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-3xl border border-border bg-card p-8">
        <h1 className="text-3xl font-bold">Couldn&apos;t load this session</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{error}</p>
        <Link href="/home" className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground">
          Back to patients
        </Link>
      </div>
    )
  }

  if (!session || !patient) {
    return <p className="text-lg text-muted-foreground">Loading…</p>
  }

  const mode = uiMode(session.mode, audio)
  const step = buildStep(session, mode, tap, answerQuestion, { open: moreOpen, setOpen: setMoreOpen })

  const level = session.ladder.level
  const done = session.status === 'escalated' || session.status === 'sent' || session.status === 'cancelled'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/home"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
          >
            <X className="size-4" aria-hidden="true" />
            Exit
          </Link>
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-primary-soft px-4 text-sm font-semibold text-primary">
            {patient.name} · {patient.room}
          </span>
        </div>
        {user?.role === 'patient' && (
          <button
            type="button"
            onClick={() => logout()}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </button>
        )}
      </div>

      {/* Communication ladder: the backend steps the level down when answering gets harder, up when it
          gets easier again (backend/app/engine/ladder.py). Bigger buttons come with level 2. */}
      <LevelBar ladder={session.ladder} audio={audio} onLevel={setLevel} onAudio={(on) => updateSettings({ spokenPrompts: on })} />
      <LevelTransition level={level} />
      {level === 4 && !done && <AssistCard assist={session.ladder.assist} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          {session.status === 'waiting_consult' && session.consult ? (
            <ConsultBanner personName={session.consult.person_name} relation={session.consult.relation} onSkip={skipConsult} />
          ) : done ? (
            <section
              className={cn(
                'flex flex-col items-start gap-5 rounded-3xl border p-6 md:p-8',
                session.status === 'escalated' ? 'border-urgent bg-urgent-soft' : 'border-border bg-card',
              )}
            >
              <span
                className={cn(
                  'flex size-14 items-center justify-center rounded-2xl',
                  session.status === 'escalated' ? 'bg-urgent text-urgent-foreground' : 'bg-success-soft text-success',
                )}
              >
                {session.status === 'escalated' ? <Siren className="size-7" aria-hidden="true" /> : <CircleCheckBig className="size-7" aria-hidden="true" />}
              </span>
              <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold text-balance md:text-4xl">
                  {session.status === 'escalated' ? 'Help is coming' : session.status === 'sent' ? 'Your nurse has your message' : 'Cancelled'}
                </h1>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  {session.status === 'escalated'
                    ? 'A nurse has your message and is on the way.'
                    : session.status === 'sent'
                      ? "We'll let you know if anyone needs more from you."
                      : 'You can start again whenever you need to.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-16 items-center gap-3 rounded-2xl bg-primary px-8 text-xl font-bold text-primary-foreground hover:bg-primary/90"
              >
                Start again
              </button>
            </section>
          ) : step ? (
            <AnimatePresence mode="wait" initial={false}>
              <QuestionStage
                key={`${step.id}-${mode}-${level}`}
                step={step}
                stepNumber={session.taps + 1}
                mode={mode}
                level={level}
                canUndo={session.can_go_back}
                onUndo={goBack}
                onSignal={signal}
              />
            </AnimatePresence>
          ) : null}

          {busy && <p className="text-base text-muted-foreground" aria-live="polite">Sending…</p>}
          {error && <p className="text-base text-urgent">{error}</p>}
        </div>

        <aside className="flex flex-col gap-4">
          <SummaryPanel session={session} showEngine={showEngine} onToggleEngine={() => setShowEngine((v) => !v)} />
        </aside>
      </div>

      {welfare && (
        <button
          type="button"
          onClick={respondWelfare}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-foreground p-8 text-center text-background"
        >
          <span className="text-balance text-4xl font-bold leading-tight md:text-6xl">Are you okay? Tap anywhere.</span>
          <span className="text-lg opacity-80">Someone asked us to check on you.</span>
          <span className="font-mono text-5xl tabular-nums opacity-70">{welfareSecondsLeft}</span>
        </button>
      )}
    </div>
  )
}
