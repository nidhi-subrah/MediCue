'use client'

import { Minus, Plus, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { LadderLevel, LadderState } from '@/lib/types'
import { cn } from '@/lib/utils'

const LEVELS: LadderLevel[] = [1, 2, 3, 4]

/** What the patient is told when the screen changes. Calm, no blame: it's the screen that changes. */
const PATIENT_COPY: Record<LadderLevel, { title: string; body: string }> = {
  1: { title: 'Showing all choices', body: 'Every choice is back on the screen.' },
  2: { title: 'Making this easier', body: 'Fewer, bigger choices.' },
  3: { title: 'Making this easier', body: 'Just yes or no from here.' },
  4: { title: "Let's get some help", body: 'Someone nearby can help you answer.' },
}

/** Communication ladder (backend/app/engine/ladder.py): where the patient is, and a manual
 *  "easier / more choices" for the patient or a nurse at the bedside. */
export function LevelBar({
  ladder,
  audio,
  onLevel,
  onAudio,
}: {
  ladder: LadderState
  audio: boolean
  onLevel: (level: LadderLevel) => void
  onAudio: (on: boolean) => void
}) {
  const level = ladder.level
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-2 pl-4">
      <div className="flex items-center gap-3" aria-live="polite">
        <ol className="flex items-center gap-1" aria-hidden="true">
          {LEVELS.map((l) => (
            <li
              key={l}
              className={cn('h-2 w-6 rounded-full transition-colors duration-500', l <= level ? 'bg-primary' : 'bg-muted')}
            />
          ))}
        </ol>
        <span className="text-sm font-semibold">
          <span className="sr-only">Screen level {level} of 4: </span>
          {ladder.levels[level] ?? ladder.label}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onLevel((level + 1) as LadderLevel)}
          disabled={level >= 4}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-muted disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden="true" />
          Make it easier
        </button>
        <button
          type="button"
          onClick={() => onLevel((level - 1) as LadderLevel)}
          disabled={level <= 1}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-muted disabled:opacity-40"
        >
          <Minus className="size-4" aria-hidden="true" />
          More choices
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={audio}
          onClick={() => onAudio(!audio)}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold',
            audio ? 'bg-primary-soft text-primary' : 'hover:bg-muted',
          )}
        >
          {audio ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          Read aloud
        </button>
      </div>
    </div>
  )
}

/** A short, calm card when the level changes mid-conversation, so the reshaped screen isn't a surprise. */
export function LevelTransition({ level }: { level: LadderLevel }) {
  const previous = useRef(level)
  const [shown, setShown] = useState<LadderLevel | null>(null)

  useEffect(() => {
    if (level === previous.current) return
    previous.current = level
    setShown(level)
    const t = window.setTimeout(() => setShown(null), 2400)
    return () => window.clearTimeout(t)
  }, [level])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          role="status"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          className="pointer-events-none fixed inset-x-4 top-24 z-40 mx-auto flex max-w-md flex-col items-center gap-1 rounded-3xl border border-primary/30 bg-primary-soft p-6 text-center shadow-xl shadow-primary/10"
        >
          <span className="text-2xl font-bold text-primary">{PATIENT_COPY[shown].title}</span>
          <span className="text-lg text-foreground">{PATIENT_COPY[shown].body}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
