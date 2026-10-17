'use client'

import { ArrowLeft, ChevronsRight, Volume2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useSpeaker } from '@/hooks/use-speaker'
import type { ChoiceItem, CommunicationLevel, InputMode, Presentation, Step } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BodyMap } from './body-map'
import { ChoiceCard } from './choice-card'

const SOFT_EASE = [0.22, 1, 0.36, 1] as const
const EASY_PAGE = 4

/** One question on the bedside tablet. Adaptive communication's Interface Renderer (layer 3): it draws what
 *  the backend's policy decided (`presentation`: button size, spacing, confirmation, read aloud) and reports
 *  what the patient did (missed taps, "Change", read-aloud presses). It never decides to adapt. */
export function QuestionStage({
  step,
  stepNumber,
  mode,
  level = 1,
  presentation,
  language = 'en',
  text = {},
  canUndo,
  onUndo,
  onSignal,
}: {
  step: Step
  stepNumber: number
  mode: InputMode
  level?: CommunicationLevel
  presentation?: Presentation
  language?: string
  text?: Record<string, string>
  canUndo: boolean
  onUndo: () => void
  onSignal?: (kind: 'miss' | 'correction' | 'read_aloud') => void
}) {
  const { say, stop } = useSpeaker(language)
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<ChoiceItem | null>(null)   // waiting for "Is that right?"
  const pendingAt = useRef(0)
  const yesNo = level >= 3 && step.kind === 'yesno'
  const audio = mode === 'audio' || !!presentation?.audio
  const confirm = !!presentation?.confirm_selections && step.kind !== 'yesno'
  const big = presentation?.button_size === 'large' || presentation?.button_size === 'huge' || mode === 'easy'
  const roomy = presentation?.spacing === 'extra'
  const t = (key: string, fallback: string) => text[key] ?? fallback

  const items: ChoiceItem[] = step.options.map((opt) => ({
    ...opt,
    onSelect: () => {
      stop()
      if (confirm && opt.tone !== 'control') {
        pendingAt.current = performance.now()
        setPending(opt)
        if (audio) say(`${t('selected', 'You selected')} ${opt.label}. ${t('confirm', 'Is that right?')}`)
        return
      }
      if (audio && opt.tone !== 'control') say(opt.label)   // spoken confirmation of the choice
      opt.onSelect()
    },
  }))

  const readAll = () => {
    const list = step.options.map((o, i) => `${i + 1}: ${o.label}.`).join(' ')
    say(yesNo ? step.prompt : `${step.prompt}. ${list}`)
  }

  // Read aloud: the question, then each numbered choice. Yes / No reads the question.
  useEffect(() => {
    if (!audio && !yesNo) return
    readAll()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, audio, yesNo, say, stop])

  useEffect(() => {
    if (!audio) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= step.options.length) {
        e.preventDefault()
        items[n - 1]?.onSelect()
      } else if (e.key.toLowerCase() === 'r') {
        onSignal?.('read_aloud')
        readAll()
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
  // Adaptive communication already trims the list from Simplified on: only page a long list in Easy Touch.
  const paged = mode === 'easy' && level === 1 && !presentation
  const visible = paged ? items.slice(page * EASY_PAGE, page * EASY_PAGE + EASY_PAGE) : items

  if (pending) {
    // "You selected Chest pressure. Is that right?" [Yes] [Change]. The time spent here isn't slowness.
    const yes: ChoiceItem = {
      id: 'confirm-yes', label: t('yes', 'Yes'), tone: 'primary',
      onSelect: () => {
        const p = pending
        setPending(null)
        p.onSelect(performance.now() - pendingAt.current)
      },
    }
    const change: ChoiceItem = {
      id: 'confirm-change', label: t('change', 'Change'), tone: 'control',
      onSelect: () => {
        setPending(null)
        onSignal?.('correction')
      },
    }
    return (
      <motion.section
        key={`confirm-${pending.id}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: SOFT_EASE } }}
        aria-labelledby="confirm-prompt"
        className="flex flex-col gap-6 rounded-3xl border-2 border-primary/40 bg-card p-5 md:p-8"
      >
        <p className="text-lg text-muted-foreground">{t('selected', 'You selected')}</p>
        <h1 id="confirm-prompt" className="text-4xl font-bold leading-tight text-balance md:text-5xl">
          {pending.label}. {t('confirm', 'Is that right?')}
        </h1>
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <li><ChoiceCard item={yes} size="huge" /></li>
          <li><ChoiceCard item={change} size="huge" /></li>
        </ul>
      </motion.section>
    )
  }

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
          <div className="flex items-center gap-2">
            {audio && (
              <button
                type="button"
                onClick={() => {
                  onSignal?.('read_aloud')
                  readAll()
                }}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-base font-semibold hover:bg-muted"
              >
                <Volume2 className="size-5" aria-hidden="true" />
                {t('replay', 'Read again')}
              </button>
            )}
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
                {t('back', 'Back')}
              </button>
            )}
          </div>
        </div>
        <h1
          id="question-prompt"
          className={cn(
            'font-bold leading-tight text-balance',
            yesNo ? 'text-5xl md:text-6xl' : big ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl',
          )}
        >
          {step.prompt}
        </h1>
        {step.helper && !big && <p className="text-lg leading-relaxed text-muted-foreground">{step.helper}</p>}
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
          className={cn(
            'grid grid-cols-1',
            roomy ? 'gap-6' : big || yesNo ? 'gap-4' : 'gap-3',
            yesNo || big ? 'sm:grid-cols-2' : step.kind === 'yesno' ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
          )}
        >
          {visible.map((item, i) => (
            <motion.li
              key={`${page}-${item.id}`}
              layout
              className={yesNo && item.id === 'unsure' ? 'sm:col-span-2' : undefined}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.04, duration: 0.3, ease: SOFT_EASE }}
            >
              <ChoiceCard
                item={item}
                size={yesNo && item.id !== 'unsure' ? 'huge' : big || yesNo ? 'large' : 'regular'}
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
