'use client'

import { ArrowLeft, ChevronsRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useSpeaker } from '@/hooks/use-speaker'
import { useUiAssist } from '@/lib/live/ui-assist'
import type { ChoiceItem, InputMode, Step } from '@/lib/types'
import { BodyMap } from './body-map'
import { ChoiceCard } from './choice-card'

const SOFT_EASE = [0.22, 1, 0.36, 1] as const
const EASY_PAGE = 4
const DELAY_MS = 25000

export function QuestionStage({
  step,
  stepNumber,
  mode,
  canUndo,
  onUndo,
}: {
  step: Step
  stepNumber: number
  mode: InputMode
  canUndo: boolean
  onUndo: () => void
}) {
  const { say, stop } = useSpeaker()
  const recordSignal = useUiAssist((s) => s.recordSignal)
  const [page, setPage] = useState(0)

  const items: ChoiceItem[] = step.options.map((opt) => ({
    ...opt,
    onSelect: () => {
      stop()
      opt.onSelect()
    },
  }))

  useEffect(() => {
    const timer = setTimeout(() => recordSignal('delay', mode), DELAY_MS)
    return () => clearTimeout(timer)
  }, [step.id, mode, recordSignal])

  // Audio First is the only mode that speaks: the question, then each numbered choice.
  useEffect(() => {
    if (mode !== 'audio') return
    const list = step.options.map((o, i) => `${i + 1}: ${o.label}.`).join(' ')
    say(`${step.prompt}. ${list}`)
    return () => stop()
  }, [step, mode, say, stop])

  useEffect(() => {
    if (mode !== 'audio') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= step.options.length) {
        e.preventDefault()
        items[n - 1]?.onSelect()
      } else if (e.key.toLowerCase() === 'r') {
        const list = step.options.map((o, i) => `${i + 1}: ${o.label}.`).join(' ')
        say(`${step.prompt}. ${list}`)
      } else if (e.key === 'Backspace' && canUndo) {
        onUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onMiss = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('button, input, textarea, a, svg')) recordSignal('miss', mode)
  }

  const pageCount = Math.ceil(items.length / EASY_PAGE)
  const visible = mode === 'easy' ? items.slice(page * EASY_PAGE, page * EASY_PAGE + EASY_PAGE) : items

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
          className={
            mode === 'easy'
              ? 'text-4xl font-bold leading-tight text-balance md:text-5xl'
              : 'text-3xl font-bold leading-tight text-balance md:text-4xl'
          }
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
            mode === 'easy'
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
              : step.kind === 'yesno'
                ? 'grid grid-cols-1 gap-3 sm:grid-cols-3'
                : 'grid grid-cols-1 gap-3 sm:grid-cols-2'
          }
        >
          {visible.map((item, i) => (
            <motion.li
              key={`${page}-${item.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.04, duration: 0.3, ease: SOFT_EASE }}
            >
              <ChoiceCard
                item={item}
                size={mode === 'easy' ? 'large' : 'regular'}
                number={mode === 'audio' ? items.indexOf(item) + 1 : undefined}
              />
            </motion.li>
          ))}
          {mode === 'easy' && pageCount > 1 && (
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
