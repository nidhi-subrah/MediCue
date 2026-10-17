'use client'

import { motion } from 'motion/react'
import { toast } from 'sonner'
import { MODES, MODE_ORDER } from '@/lib/modes'
import type { InputMode } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ModeSwitcher({
  mode,
  onChange,
  className,
}: {
  mode: InputMode
  onChange: (mode: InputMode) => void
  className?: string
}) {
  const choose = (next: InputMode) => {
    if (next === mode) return
    onChange(next)
    toast(`Switched to ${MODES[next].label}`, { description: MODES[next].description })
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p id="mode-label" className="text-sm font-semibold text-muted-foreground">
        How would you like to answer?
      </p>
      <div
        role="radiogroup"
        aria-labelledby="mode-label"
        className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1"
      >
        {MODE_ORDER.map((id) => {
          const m = MODES[id]
          const Icon = m.icon
          const active = id === mode
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${m.label}: ${m.description}`}
              onClick={() => choose(id)}
              className={cn(
                'relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors sm:h-12 sm:flex-row sm:gap-2 sm:text-sm',
                active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId="mode-pill"
                  className="absolute inset-0 rounded-xl bg-primary"
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  aria-hidden="true"
                />
              )}
              <Icon className="relative size-5 sm:size-4" aria-hidden="true" />
              <span className="relative">{m.short}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
