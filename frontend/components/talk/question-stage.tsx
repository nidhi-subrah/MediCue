'use client'

import { ArrowLeft, ChevronsRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useSpeaker } from '@/hooks/use-speaker'
import { isSpeaking } from '@/lib/speech'
import { useVoiceMode } from '@/lib/live/voice-mode'
import type { ChoiceItem, InputMode, LadderLevel, Step } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BodyMap } from './body-map'
import { ChoiceCard } from './choice-card'

const SOFT_EASE = [0.22, 1, 0.36, 1] as const
const EASY_PAGE = 4

export function QuestionStage({
  step,
  stepNumber,
  mode,
  level = 1,
  canUndo,
  onUndo,
  onSignal,
}: {
  step: Step
  stepNumber: number
  mode: InputMode
  level?: LadderLevel
  canUndo: boolean
  onUndo: () => void
  /** A missed tap: the backend's communication ladder counts it (backend/app/engine/ladder.py). */
  onSignal?: (kind: 'miss') => void
}) {
  const { say, stop } = useSpeaker()
  const [page, setPage] = useState(0)
  const yesNo = level >= 3 && step.kind === 'yesno'

  const items: ChoiceItem[] = step.options.map((opt) => ({
    ...opt,
    onSelect: () => {
      stop()
      opt.onSelect()
    },
  }))

  // With the mic on the patient answers out loud, so read-aloud speaks only the question: nobody in distress
  // should have to wait through the options. A ref (not a dependency) so toggling the mic doesn't re-read.
  const micOn = useVoiceMode((s) => s.on)
  const micOnRef = useRef(micOn)
  micOnRef.current = micOn
  const spokenText = () => {
    if (micOnRef.current) return step.prompt
    const list = step.options.map((o, i) => `${i + 1}: ${o.label}.`).join(' ')
    return `${step.prompt}. ${list}`
  }

  // Turning the mic on while the options are already being read cuts them off: restart with just the question.
  const wasMicOn = useRef(micOn)
  useEffect(() => {
    if (micOn && !wasMicOn.current && mode === 'audio' && isSpeaking()) say(step.prompt)
    wasMicOn.current = micOn
  }, [micOn])

  // Audio First speaks the question, then each numbered choice. Yes / No level reads the question aloud.
  useEffect(() => {
    if (yesNo && mode !== 'audio') {
      say(`${step.prompt}`)
      return () => stop()
    }
    if (mode !== 'audio') return
    say(spokenText())
    return () => stop()
    // Keyed on what the question *is*, not the `step` object: that is rebuilt on every render of the page,
    // so depending on it re-read the same question each time anything (a pending answer, a toast) re-rendered.
  }, [step.id, step.prompt, mode, yesNo, say, stop])

  useEffect(() => {
    if (mode !== 'audio') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= step.options.length) {
        e.preventDefault()
        items[n - 1]?.onSelect()
      } else if (e.key.toLowerCase() === 'r') {
        say(spokenText())
      } else if (e.key === 'Backspace' && canUndo) {
        onUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onMiss = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('button, input, textarea, a, svg')) onSignal?.('miss')
  }

  const pageCount = Math.ceil(items.length / EASY_PAGE)
  // The ladder already trims the list from level 2, so only page a long list the patient chose Easy for.
  const paged = mode === 'easy' && level === 1
  const visible = paged ? items.slice(page * EASY_PAGE, page * EASY_PAGE + EASY_PAGE) : items

  return (
    <motion.section
      key={step.id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: SOFT_EASE } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.16, ease: 'easeIn' } }}
      aria-labelledby="question-prompt"
      onPointerDown={onMiss}
      className="flex flex-col gap-6 rounded-3xl border border-border bg-card p-5 md:p-8"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Step {stepNumber} <span className="normal-case tracking-normal">· take your time</span>
          </p>
          {canUndo && (
            <button
              type="button"
              onClick={() => {
                stop()
                onUndo()
              }}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-base font-semibold hover:bg-muted"
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
              Back
            </button>
          )}
        </div>
        <h1
          id="question-prompt"
          className={cn(
            'font-bold leading-tight text-balance',
            yesNo ? 'text-5xl md:text-6xl' : mode === 'easy' ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl',
          )}
        >
          {step.prompt}
        </h1>
        {step.helper && mode !== 'easy' && (
          <p className="text-lg leading-relaxed text-muted-foreground">{step.helper}</p>
        )}
      </div>

      {step.kind === 'body' && mode !== 'audio' && (
        <div className="flex justify-center rounded-2xl bg-surface p-4">
          <BodyMap items={items} />
        </div>
      )}

      {mode === 'audio' && (
        <p className="rounded-xl bg-surface p-4 text-base leading-relaxed text-muted-foreground">
          Press a number key to answer. Press <kbd className="font-mono font-semibold">R</kbd> to
          repeat, <kbd className="font-mono font-semibold">Backspace</kbd> to go back.
        </p>
      )}

      {!(step.kind === 'body' && mode !== 'audio') && (
        <ul
          className={
            yesNo
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
              : mode === 'easy'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
                : step.kind === 'yesno'
                  ? 'grid grid-cols-1 gap-3 sm:grid-cols-3'
                  : 'grid grid-cols-1 gap-3 sm:grid-cols-2'
          }
        >
          {visible.map((item, i) => (
            <motion.li
              key={`${page}-${item.id}`}
              className={yesNo && item.id === 'unsure' ? 'sm:col-span-2' : undefined}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.04, duration: 0.3, ease: SOFT_EASE }}
            >
              <ChoiceCard
                item={item}
                size={yesNo && item.id !== 'unsure' ? 'huge' : mode === 'easy' || yesNo ? 'large' : 'regular'}
                number={mode === 'audio' ? items.indexOf(item) + 1 : undefined}
              />
            </motion.li>
          ))}
          {paged && pageCount > 1 && (
            <li className="sm:col-span-2">
              <ChoiceCard
                size="large"
                item={{
                  id: '__more',
                  label: page + 1 < pageCount ? 'More choices' : 'Back to first choices',
                  icon: ChevronsRight,
                  tone: 'control',
                  onSelect: () => setPage((p) => (p + 1) % pageCount),
                }}
              />
            </li>
          )}
        </ul>
      )}
    </motion.section>
  )
}
