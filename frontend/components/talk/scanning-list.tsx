'use client'

import { Pause, Play, Pointer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSpeaker } from '@/hooks/use-speaker'
import { useSettings } from '@/lib/store/settings'
import type { ChoiceItem } from '@/lib/types'
import { ChoiceCard } from './choice-card'

export function ScanningList({ items }: { items: ChoiceItem[] }) {
  const scanSpeed = useSettings((s) => s.scanSpeed)
  const update = useSettings((s) => s.update)
  const spokenPrompts = useSettings((s) => s.spokenPrompts)
  const { say } = useSpeaker()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = items[index % items.length]

  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), scanSpeed)
    return () => clearInterval(timer)
  }, [paused, scanSpeed, items.length])

  useEffect(() => {
    refs.current[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (spokenPrompts && current) say(current.label)
  }, [index, current, spokenPrompts, say])

  const select = () => current?.onSelect()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [role="dialog"]')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        current?.onSelect()
      } else if (e.key.toLowerCase() === 'p') {
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current])

  const speeds = [
    { label: 'Slow', value: 2800 },
    { label: 'Medium', value: 1800 },
    { label: 'Fast', value: 1100 },
  ]

  return (
    <div className="flex flex-col gap-5">
      <p className="sr-only" aria-live="polite">
        {current ? `Highlighted: ${current.label}` : ''}
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={item.id}>
            <ChoiceCard
              ref={(el) => {
                refs.current[i] = el
              }}
              item={item}
              highlighted={i === index % items.length}
              tabbable={false}
            />
          </li>
        ))}
      </ul>

      <div className="sticky bottom-24 flex flex-col gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur md:bottom-4 md:flex-row md:items-center">
        <button
          type="button"
          onClick={select}
          className="flex min-h-16 flex-1 items-center justify-center gap-3 rounded-xl bg-primary px-6 text-xl font-bold text-primary-foreground hover:bg-primary/90"
        >
          <Pointer className="size-6" aria-hidden="true" />
          Select
          <span className="text-sm font-medium opacity-80">(Space / Enter)</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="flex h-16 items-center gap-2 rounded-xl border-2 border-border px-4 text-base font-semibold hover:bg-muted"
          >
            {paused ? <Play className="size-5" aria-hidden="true" /> : <Pause className="size-5" aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <div role="radiogroup" aria-label="Scanning speed" className="flex rounded-xl border-2 border-border p-1">
            {speeds.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={scanSpeed === s.value}
                onClick={() => update({ scanSpeed: s.value })}
                className={
                  scanSpeed === s.value
                    ? 'h-12 rounded-lg bg-primary-soft px-3 text-sm font-semibold text-primary'
                    : 'h-12 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground'
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
