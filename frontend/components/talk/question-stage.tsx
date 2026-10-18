'use client'

import { ArrowLeft, ChevronsRight, Volume2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useSpeaker } from '@/hooks/use-speaker'
import { isSpeaking } from '@/lib/speech'
import { useVoiceMode } from '@/lib/live/voice-mode'
import type { ChoiceItem, CommunicationLevel, InputMode, Presentation, Step } from '@/lib/types'
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
  presentation,
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
  text?: Record<string, string>
  canUndo: boolean
  onUndo: () => void
  onSignal?: (kind: 'miss' | 'correction' | 'read_aloud') => void
}) {
  const { say, stop } = useSpeaker()
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<ChoiceItem | null>(null)
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
      if (audio && opt.tone !== 'control') say(opt.label)
      opt.onSelect()
    },
  }))

  const micOn = useVoiceMode((s) => s.on)
  const micOnRef = useRef(micOn)
  micOnRef.current = micOn
  const spokenText = () => {
    if (yesNo || micOnRef.current) return step.prompt
    const list = step.options.map((o, i) => `${i + 1}: ${o.label}.`).join(' ')
    return `${step.prompt}. ${list}`
  }
  const readAll = () => say(spokenText())

  const wasMicOn = useRef(micOn)
  useEffect(() => {
    if (micOn && !wasMicOn.current && audio && isSpeaking()) say(step.prompt)
    wasMicOn.current = micOn
  }, [micOn])

  useEffect(() => {
    if (!audio && !yesNo) return
    readAll()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, step.prompt, audio, yesNo, say, stop])

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
  const paged = mode === 'easy' && level === 1 && !presentation
  const visible = paged ? items.slice(page * EASY_PAGE, page * EASY_PAGE + EASY_PAGE) : items

  if (pending) {
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
        className="patient-section flex flex-col gap-6 !border-primary/30"
      >
        <p className="eyebrow text-primary">{t('selected', 'You selected')}</p>
        <h1 id="confirm-prompt" className="text-4xl font-semibold leading-tight text-balance md:text-5xl">
          {pending.label}. {t('confirm', 'Is that right?')}
        </h1>
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
      className={cn('patient-section flex flex-col', step.kind === 'body' ? 'gap-4 md:!p-6' : 'gap-6')}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/8 font-mono text-xs font-semibold text-primary">
              {stepNumber}
            </span>
            <p className="text-sm font-medium text-muted-foreground">
              Take your time
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {audio && (
              <button
                type="button"
                onClick={() => {
                  onSignal?.('read_aloud')
                  readAll()
                }}
                className="patient-btn"
              >
                <Volume2 className="size-4" aria-hidden="true" />
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
                className="patient-btn"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t('back', 'Back')}
              </button>
            )}
          </div>
        </div>
        <h1
          id="question-prompt"
          className={cn(
            'font-semibold leading-tight text-balance',
            yesNo ? 'text-5xl md:text-6xl' : big ? 'text-4xl md:text-5xl' : step.kind === 'body' ? 'text-3xl' : 'text-3xl md:text-4xl',
          )}
        >
          {step.prompt}
        </h1>
        {step.helper && !big && <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{step.helper}</p>}
      </div>

      {step.kind === 'body' && mode !== 'audio' && (
        <div className="flex justify-center rounded-2xl bg-[oklch(0.98_0.004_260_/_0.6)] p-3 backdrop-blur-sm sm:p-4">
          <BodyMap items={items} />
        </div>
      )}

      {mode === 'audio' && (
        <div className="glass-subtle rounded-xl p-4 text-base leading-relaxed text-muted-foreground">
          Press a number key to answer. Press <kbd className="rounded bg-primary/8 px-1.5 py-0.5 font-mono font-semibold text-foreground">R</kbd> to
          repeat, <kbd className="rounded bg-primary/8 px-1.5 py-0.5 font-mono font-semibold text-foreground">Backspace</kbd> to go back.
        </div>
      )}

      {!(step.kind === 'body' && mode !== 'audio') && (
        <ul
          className={cn(
            'grid grid-cols-1',
            roomy ? 'gap-5' : big || yesNo ? 'gap-4' : 'gap-3',
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
              transition={{ delay: 0.06 + i * 0.04, duration: 0.35, ease: SOFT_EASE }}
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
