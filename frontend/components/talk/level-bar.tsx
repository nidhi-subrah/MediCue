'use client'

import { HandHelping, Minus, Plus, Volume2, VolumeX } from 'lucide-react'
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

export function LevelBar({
  comm,
  onLevel,
  onAudio,
}: {
  comm: CommunicationState
  onLevel: (level: CommunicationLevel) => void
  onAudio: (on: boolean) => void
}) {
  const level = comm.level
  const chips = comm.modifiers.flatMap((m) => (MODIFIER_WORDS[m] ? [MODIFIER_WORDS[m] as string] : []))
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="glass flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 pl-5"
    >
      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <div className="flex items-center gap-1" aria-hidden="true">
          {LEVELS.map((l) => (
            <span
              key={l}
              className={cn(
                'h-1.5 rounded-full transition-all duration-500',
                l <= level
                  ? 'w-7 bg-gradient-to-r from-primary to-[oklch(0.4_0.1_262)]'
                  : 'w-5 bg-[oklch(0.94_0.006_260)]',
              )}
            />
          ))}
        </div>
        <span className="text-sm font-medium">
          <span className="sr-only">Communication mode {level} of 4: </span>
          {comm.levels[level] ?? comm.label}
        </span>
        {chips.map((c) => (
          <span key={c} className="rounded-full bg-primary/8 px-2.5 py-0.5 text-xs font-semibold text-primary">{c}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onLevel((level + 1) as CommunicationLevel)} disabled={level >= 4}
                className="patient-btn disabled:opacity-35">
          <Plus className="size-4" aria-hidden="true" /> Make it easier
        </button>
        <button type="button" onClick={() => onLevel((level - 1) as CommunicationLevel)} disabled={level <= 1}
                className="patient-btn disabled:opacity-35">
          <Minus className="size-4" aria-hidden="true" /> More choices
        </button>
        <button type="button" role="switch" aria-checked={comm.audio_enabled} onClick={() => onAudio(!comm.audio_enabled)}
                className={cn('patient-btn',
                              comm.audio_enabled && '!bg-primary/10 !border-primary/30 text-primary')}>
          {comm.audio_enabled ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          Read aloud
        </button>
      </div>
    </motion.div>
  )
}

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
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.5 } }}
          className="pointer-events-none fixed inset-x-4 top-24 z-40 mx-auto max-w-md"
        >
          <div className="glass rounded-2xl border-primary/20 p-6 text-center text-2xl font-semibold text-primary shadow-xl shadow-primary/10">
            {shown}
          </div>
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

export function OfferCard({ comm, onAnswer }: { comm: CommunicationState; onAnswer: (offer: 'audio_first' | 'assisted', choice: string) => void }) {
  const o = comm.offer
  if (!o) return null
  return (
    <motion.section
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      aria-labelledby="offer-h"
      className="patient-section flex flex-col gap-5 !border-primary/30 !bg-[oklch(0.97_0.015_262_/_0.7)]"
    >
      <h2 id="offer-h" className="flex items-center gap-3 text-2xl font-semibold text-balance md:text-3xl">
        {o.offer === 'assisted' ? <HandHelping className="size-8 shrink-0 text-primary" aria-hidden="true" />
                                : <Volume2 className="size-8 shrink-0 text-primary" aria-hidden="true" />}
        {o.message}
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {o.choices.map((c, i) => (
          <button key={c} type="button" onClick={() => onAnswer(o.offer, c)}
                  className={cn('min-h-16 rounded-2xl px-5 text-xl font-semibold transition-all duration-200 active:scale-[0.97]',
                                i === 0 ? 'bg-primary text-primary-foreground shadow-md shadow-primary/15 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20'
                                        : 'glass-subtle hover:bg-[oklch(0.96_0.006_260_/_0.8)]')}>
            {comm.text[CHOICE_TEXT[c][0]] ?? CHOICE_TEXT[c][1]}
          </button>
        ))}
      </div>
    </motion.section>
  )
}
