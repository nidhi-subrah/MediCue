'use client'

import { CircleCheckBig, Eye, LogOut, Siren, SlidersHorizontal, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/app/auth-provider'
import { Brand } from '@/components/app/brand'
import { useSpeaker } from '@/hooks/use-speaker'
import { ShowSomeone } from '@/components/app/show-someone'
import { UrgentButton } from '@/components/app/urgent-button'
import { useLiveSession } from '@/lib/live/session'
import { buildStep, patientMessage, uiMode } from '@/lib/live/talk-adapter'
import { useSettings } from '@/lib/store/settings'
import { cn } from '@/lib/utils'
import { AssistCard } from './assist-card'
import { ConsultBanner } from './consult-banner'
import { LevelBar, LevelTransition, OfferCard } from './level-bar'
import { QuestionStage } from './question-stage'
import { TabletSettings } from './tablet-settings'
import { VoiceInput } from './voice-input'

export function TalkView() {
  const { patient, session, error, busy, welfare, welfareSecondsLeft, tap, answerQuestion, skipConsult, goBack, respondWelfare,
    signal, setLevel, setAudio, answerOffer } = useLiveSession()
  const { user, logout } = useAuth()
  const audioPreference = useSettings((s) => s.spokenPrompts)
  const [moreOpen, setMoreOpen] = useState(false)
  const stepKey = session ? `${session.session_id}-${session.status}-${session.taps}-${session.communication.level}` : ''
  useEffect(() => setMoreOpen(false), [stepKey])
  const sentPreference = useRef<string | null>(null)
  useEffect(() => {
    if (!session || !audioPreference || sentPreference.current === session.session_id) return
    sentPreference.current = session.session_id
    if (!session.communication.audio_enabled) setAudio(true)
  }, [session, audioPreference, setAudio])

  const { say, stop } = useSpeaker()
  const sent = session?.status === 'sent'
  const readAloud = !!session?.communication.audio_enabled
  useEffect(() => {
    if (!sent || !readAloud) return
    say("Your nurse has your message. We'll let you know if anyone needs more from you.")
    return () => stop()
  }, [sent, readAloud, say, stop])
  const [showToSomeone, setShowToSomeone] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  if (error && !session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="patient-section flex flex-col items-start gap-5"
      >
        <div className="flex size-14 items-center justify-center rounded-2xl bg-urgent/10">
          <Siren className="size-7 text-urgent" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-semibold">Couldn&apos;t load this session</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90"
        >
          Try again
        </button>
      </motion.div>
    )
  }

  if (!session || !patient) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="size-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <p className="text-base text-muted-foreground">Preparing your session…</p>
        </motion.div>
      </div>
    )
  }

  const comm = session.communication
  const mode = uiMode(session.mode, false)
  const step = buildStep(session, mode, tap, answerQuestion, { open: moreOpen, setOpen: setMoreOpen })

  const level = comm.level
  const done = session.status === 'escalated' || session.status === 'sent' || session.status === 'cancelled'
  const lastMessage = patientMessage(session)

  return (
    <div className="flex flex-col gap-5">
      {/* Top bar: patient info + actions */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="glass flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Brand />
          <span className="patient-chip">
            <span className="size-2 rounded-full bg-success" aria-hidden="true" />
            {patient.name} · {patient.room}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowToSomeone(true)}
            className="patient-btn"
          >
            <Eye className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Show to someone</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="patient-btn"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Display &amp; sound</span>
          </button>
          {user?.role === 'patient' && (
            <button
              type="button"
              onClick={() => logout()}
              className="patient-btn"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          )}
          <UrgentButton compact patientId={patient.id} />
        </div>
      </motion.header>

      <LevelBar comm={comm} onLevel={setLevel} onAudio={setAudio} />
      <LevelTransition message={comm.message} />
      {!done && <OfferCard comm={comm} onAnswer={answerOffer} />}
      {level === 4 && !done && <AssistCard comm={comm} />}

      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-5">
          {session.status === 'waiting_consult' && session.consult ? (
            <ConsultBanner personName={session.consult.person_name} relation={session.consult.relation} onSkip={skipConsult} />
          ) : done ? (
            <motion.section
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'patient-section flex flex-col items-start gap-6',
                session.status === 'escalated' && 'border-urgent/40 bg-urgent/5',
              )}
            >
              <div className={cn(
                'flex size-16 items-center justify-center rounded-2xl',
                session.status === 'escalated'
                  ? 'bg-gradient-to-br from-urgent/20 to-urgent/10 text-urgent'
                  : 'bg-gradient-to-br from-success/20 to-success/10 text-success',
              )}>
                {session.status === 'escalated'
                  ? <Siren className="size-8" aria-hidden="true" />
                  : <CircleCheckBig className="size-8" aria-hidden="true" />}
              </div>
              <div className="flex flex-col gap-3">
                <h1 className="text-3xl font-semibold leading-tight text-balance md:text-4xl">
                  {session.status === 'escalated' ? 'Help is coming' : session.status === 'sent' ? 'Your nurse has your message' : 'Cancelled'}
                </h1>
                <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
                  {session.status === 'escalated'
                    ? 'A nurse has your message and is on the way.'
                    : session.status === 'sent'
                      ? "We'll let you know if anyone needs more from you."
                      : 'You can start again whenever you need to.'}
                </p>
              </div>
              {session.status === 'sent' && (
                <div className="flex items-center gap-2 text-sm text-success">
                  <Sparkles className="size-4" aria-hidden="true" />
                  Message delivered successfully
                </div>
              )}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-16 items-center gap-3 rounded-2xl bg-primary px-8 text-xl font-semibold text-primary-foreground shadow-lg shadow-primary/15 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/20 active:scale-[0.98]"
              >
                Start again
              </button>
            </motion.section>
          ) : step ? (
            <AnimatePresence mode="wait" initial={false}>
              <QuestionStage
                key={`${step.id}-${mode}-${level}`}
                step={step}
                stepNumber={session.taps + 1}
                mode={mode}
                level={level}
                presentation={comm.presentation}
                text={comm.text}
                canUndo={session.can_go_back}
                onUndo={goBack}
                onSignal={signal}
              />
            </AnimatePresence>
          ) : null}

          {busy && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-base text-muted-foreground"
              aria-live="polite"
            >
              <span className="size-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              Sending…
            </motion.p>
          )}
          {error && <p className="rounded-xl bg-urgent/5 px-4 py-3 text-base text-urgent">{error}</p>}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          {!done && session.status !== 'waiting_consult' && <VoiceInput />}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="patient-section flex flex-col gap-4 !p-5"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.35_0.09_262)] text-lg font-semibold text-primary-foreground shadow-md shadow-primary/20" aria-hidden="true">
                {patient.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-lg font-semibold leading-tight">Hello, {patient.name.split(' ')[0]}</span>
                <span className="eyebrow">Room {patient.room}</span>
              </div>
            </div>
            <ol className="flex flex-col gap-3 border-t border-[oklch(0.92_0.01_260_/_0.5)] pt-4 text-sm">
              {[
                ['Tell us', 'Tap, or press Speak instead.'],
                ['We check', 'Is that right? You can change it.'],
                ['Nurse knows', 'Your message goes to your nurse.'],
              ].map(([title, body], i) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">{i + 1}</span>
                  <span className="flex flex-col leading-snug">
                    <span className="font-semibold">{title}</span>
                    <span className="text-muted-foreground">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </motion.div>
        </aside>
      </div>

      {welfare && (
        <button
          type="button"
          onClick={respondWelfare}
          style={{
            paddingTop: 'max(2rem, calc(env(safe-area-inset-top) + 1rem))',
            paddingBottom: 'max(2rem, calc(env(safe-area-inset-bottom) + 1rem))',
            paddingLeft: 'max(2rem, calc(env(safe-area-inset-left) + 1rem))',
            paddingRight: 'max(2rem, calc(env(safe-area-inset-right) + 1rem))',
          }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-foreground text-center text-background"
        >
          <span className="text-balance text-4xl font-semibold leading-tight md:text-6xl">Are you okay? Tap anywhere.</span>
          <span className="text-lg opacity-80">Someone asked us to check on you.</span>
          <span className="font-mono text-5xl tabular-nums opacity-70">{welfareSecondsLeft}</span>
        </button>
      )}

      <TabletSettings
        open={showSettings}
        onOpenChange={setShowSettings}
        onAudio={(on) => { if (session.communication.audio_enabled !== on) setAudio(on) }}
      />
      <ShowSomeone open={showToSomeone} onOpenChange={setShowToSomeone} text={lastMessage} />
    </div>
  )
}
