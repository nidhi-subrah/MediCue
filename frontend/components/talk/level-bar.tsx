'use client'

import { HandHelping, Languages, Minus, Plus, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { CommunicationLevel, CommunicationModifier, CommunicationState } from '@/lib/types'
import { cn } from '@/lib/utils'

const LEVELS: CommunicationLevel[] = [1, 2, 3, 4]

const MODIFIER_WORDS: Partial<Record<CommunicationModifier, string>> = {
  large_targets: 'Bigger buttons',
  confirm_selections: 'Confirm choices',
  simple_wording: 'Simpler words',
  audio: 'Read aloud',
}

/** Where the patient is on the communication modes, and the controls that are always theirs: easier, more
 *  choices, read aloud, language. Adaptive communication (backend/app/engine/communication) changes the mode;
 *  these buttons let the patient or a nurse override it. */
export function LevelBar({
  comm,
  onLevel,
  onAudio,
  onLanguage,
}: {
  comm: CommunicationState
  onLevel: (level: CommunicationLevel) => void
  onAudio: (on: boolean) => void
  onLanguage: (language: string) => void
}) {
  const level = comm.level
  const chips = comm.modifiers.flatMap((m) => (MODIFIER_WORDS[m] ? [MODIFIER_WORDS[m] as string] : []))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-2 pl-4">
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <ol className="flex items-center gap-1" aria-hidden="true">
          {LEVELS.map((l) => (
            <li key={l} className={cn('h-2 w-6 rounded-full transition-colors duration-500', l <= level ? 'bg-primary' : 'bg-muted')} />
          ))}
        </ol>
        <span className="text-sm font-semibold">
          <span className="sr-only">Communication mode {level} of 4: </span>
          {comm.levels[level] ?? comm.label}
        </span>
        {chips.map((c) => (
          <span key={c} className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">{c}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onLevel((level + 1) as CommunicationLevel)} disabled={level >= 4}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-muted disabled:opacity-40">
          <Plus className="size-4" aria-hidden="true" /> Make it easier
        </button>
        <button type="button" onClick={() => onLevel((level - 1) as CommunicationLevel)} disabled={level <= 1}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-muted disabled:opacity-40">
          <Minus className="size-4" aria-hidden="true" /> More choices
        </button>
        <button type="button" role="switch" aria-checked={comm.audio_enabled} onClick={() => onAudio(!comm.audio_enabled)}
                className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold',
                              comm.audio_enabled ? 'bg-primary-soft text-primary' : 'hover:bg-muted')}>
          {comm.audio_enabled ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          Read aloud
        </button>
        <label className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-muted">
          <Languages className="size-4" aria-hidden="true" />
          <span className="sr-only">Language</span>
          <select value={comm.language} onChange={(e) => onLanguage(e.target.value)}
                  className="bg-transparent text-sm font-semibold outline-none">
            {Object.entries(comm.languages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}

/** The policy's message, briefly, when the screen changes ("I've simplified the choices."), so the new layout
 *  isn't a surprise. Neutral wording only; it's always the screen that changes, never a judgement. */
export function LevelTransition({ message }: { message: CommunicationState['message'] }) {
  const seen = useRef<string | null>(message?.id ?? null)
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    if (!message || message.id === seen.current) return
    seen.current = message.id
    setShown(message.text)
    const t = window.setTimeout(() => setShown(null), 2600)
    return () => window.clearTimeout(t)
  }, [message])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          role="status"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          className="pointer-events-none fixed inset-x-4 top-24 z-40 mx-auto max-w-md rounded-3xl border border-primary/30 bg-primary-soft p-6 text-center text-2xl font-bold text-primary shadow-xl shadow-primary/10"
        >
          {shown}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const CHOICE_TEXT: Record<string, [string, string]> = {
  accept: ['read_aloud_yes', 'Yes, read aloud'], decline: ['no_thanks', 'No, thanks'],
  get_nurse: ['get_nurse', 'Get nurse'], ask_caregiver: ['ask_caregiver', 'Ask someone I know'],
  keep_trying: ['keep_trying', 'Keep trying'],
}

/** A change that needs the patient's yes: audio-first, or help communicating. Big, plain, always skippable. */
export function OfferCard({ comm, onAnswer }: { comm: CommunicationState; onAnswer: (offer: 'audio_first' | 'assisted', choice: string) => void }) {
  const o = comm.offer
  if (!o) return null
  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="offer-h"
      className="flex flex-col gap-4 rounded-3xl border-2 border-primary/40 bg-primary-soft p-6"
    >
      <h2 id="offer-h" className="flex items-center gap-3 text-2xl font-bold text-balance md:text-3xl">
        {o.offer === 'assisted' ? <HandHelping className="size-8 shrink-0 text-primary" aria-hidden="true" />
                                : <Volume2 className="size-8 shrink-0 text-primary" aria-hidden="true" />}
        {o.message}
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {o.choices.map((c, i) => (
          <button key={c} type="button" onClick={() => onAnswer(o.offer, c)}
                  className={cn('min-h-16 rounded-2xl px-5 text-xl font-bold',
                                i === 0 ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                        : 'border border-border bg-card hover:bg-muted')}>
            {comm.text[CHOICE_TEXT[c][0]] ?? CHOICE_TEXT[c][1]}
          </button>
        ))}
      </div>
    </motion.section>
  )
}

/** The chart says the patient prefers another language: offer it, never switch on our own. */
export function LanguageOffer({ comm, onLanguage }: { comm: CommunicationState; onLanguage: (language: string) => void }) {
  const [dismissed, setDismissed] = useState(false)
  const lang = comm.suggested_language
  if (!lang || dismissed) return null
  const name = comm.languages[lang] ?? lang
  return (
    <section aria-label="Language" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <Languages className="size-6 text-primary" aria-hidden="true" />
      <p className="flex-1 text-lg font-semibold">Continue in {name}?</p>
      <button type="button" onClick={() => onLanguage(lang)}
              className="min-tap rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90">
        {name}
      </button>
      <button type="button" onClick={() => setDismissed(true)}
              className="min-tap rounded-xl border border-border bg-card px-5 text-base font-semibold hover:bg-muted">
        Keep English
      </button>
    </section>
  )
}
