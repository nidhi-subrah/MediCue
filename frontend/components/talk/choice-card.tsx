'use client'

import { ChevronRight } from 'lucide-react'
import { forwardRef } from 'react'
import type { ChoiceItem } from '@/lib/types'
import { cn } from '@/lib/utils'

type Size = 'regular' | 'large' | 'huge'

const toneClasses: Record<NonNullable<ChoiceItem['tone']>, { card: string; chip: string; glow: string }> = {
  default: {
    card: 'bg-[oklch(1_0_0_/_0.72)] border-[oklch(0.92_0.01_260_/_0.5)] hover:border-primary/40 hover:bg-[oklch(1_0_0_/_0.85)] hover:shadow-[0_4px_20px_-4px_oklch(0.3_0.08_262_/_0.12)]',
    chip: 'bg-primary/8 text-primary',
    glow: 'group-hover:shadow-[0_0_24px_-4px_oklch(0.5_0.1_262_/_0.15)]',
  },
  primary: {
    card: 'bg-gradient-to-b from-primary to-[oklch(0.28_0.07_259)] border-primary/60 text-primary-foreground hover:from-primary/95 hover:to-[oklch(0.26_0.065_259)] shadow-md shadow-primary/15',
    chip: 'bg-primary-foreground/15 text-primary-foreground',
    glow: '',
  },
  urgent: {
    card: 'bg-[oklch(0.98_0.01_24_/_0.8)] border-urgent/25 hover:border-urgent/45 hover:bg-[oklch(0.97_0.015_24_/_0.9)] hover:shadow-[0_4px_20px_-4px_oklch(0.5_0.12_24_/_0.15)]',
    chip: 'bg-urgent/12 text-urgent',
    glow: 'group-hover:shadow-[0_0_24px_-4px_oklch(0.5_0.12_24_/_0.15)]',
  },
  unsure: {
    card: 'bg-[oklch(0.98_0.003_260_/_0.6)] border-dashed border-[oklch(0.9_0.008_260_/_0.5)] hover:border-primary/30 hover:bg-[oklch(0.97_0.006_260_/_0.7)]',
    chip: 'bg-card text-muted-foreground',
    glow: '',
  },
  control: {
    card: 'bg-[oklch(0.98_0.003_260_/_0.55)] border-[oklch(0.93_0.006_260_/_0.4)] hover:bg-[oklch(0.96_0.005_260_/_0.7)] hover:border-[oklch(0.9_0.01_260_/_0.5)]',
    chip: 'bg-card text-foreground',
    glow: '',
  },
}

export const ChoiceCard = forwardRef<
  HTMLButtonElement,
  {
    item: ChoiceItem
    size?: Size
    number?: number
    highlighted?: boolean
    tabbable?: boolean
  }
>(function ChoiceCard({ item, size = 'regular', number, highlighted = false, tabbable = true }, ref) {
  const tone = toneClasses[item.tone ?? 'default']
  const Icon = item.icon
  const huge = size === 'huge'
  const large = size === 'large' || huge

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => item.onSelect()}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={item.selected || undefined}
      data-highlighted={highlighted || undefined}
      className={cn(
        'group relative flex w-full items-center gap-4 rounded-3xl border text-left shadow-[0_1px_2px_oklch(0.2_0.03_260_/_0.04),0_8px_24px_-14px_oklch(0.3_0.07_262_/_0.18)] backdrop-blur-sm',
        'transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'active:scale-[0.97] active:duration-100',
        !highlighted && '-translate-y-0 hover:-translate-y-0.5',
        tone.card,
        huge ? 'min-h-32 justify-center p-6' : large ? 'min-h-[max(6rem,var(--tap))] p-5' : 'min-tap p-4',
        highlighted &&
          'z-10 border-primary bg-primary-soft shadow-[0_0_0_3px_oklch(0.94_0.025_262_/_0.6),0_0_0_5px_oklch(0.4_0.14_262_/_0.3)]',
        item.tone === 'urgent' && highlighted && 'border-urgent shadow-[0_0_0_3px_oklch(0.96_0.015_24_/_0.6),0_0_0_5px_oklch(0.52_0.17_24_/_0.3)]',
      )}
    >
      {/* Subtle inner glow on hover */}
      <span className={cn('pointer-events-none absolute inset-0 rounded-3xl transition-shadow duration-300', tone.glow)} aria-hidden="true" />

      {number !== undefined && (
        <span
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded-xl font-mono font-semibold',
            'bg-gradient-to-b from-[oklch(0.98_0.004_260)] to-[oklch(0.95_0.006_260)] border border-[oklch(0.92_0.008_260_/_0.5)] text-foreground shadow-sm',
            large ? 'size-12 text-xl' : 'size-9 text-base',
          )}
          aria-hidden="true"
        >
          {number}
        </span>
      )}
      {Icon && number === undefined && (
        <span
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded-xl',
            tone.chip,
            large ? 'size-14' : 'size-11',
          )}
          aria-hidden="true"
        >
          <Icon className={large ? 'size-7' : 'size-5'} />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className={cn('break-words font-semibold leading-snug text-pretty', huge ? 'text-4xl' : large ? 'text-2xl' : 'text-lg')}>
          {item.label}
        </span>
        {item.hint && (
          <span
            className={cn(
              'leading-relaxed',
              item.tone === 'primary' ? 'text-primary-foreground/80' : 'text-muted-foreground',
              large ? 'text-lg' : 'text-sm',
            )}
          >
            {item.hint}
          </span>
        )}
      </span>
      {!huge && item.tone !== 'control' && item.tone !== 'unsure' && (
        <ChevronRight
          className="absolute right-3 top-1/2 size-4 -translate-x-1 -translate-y-1/2 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:-translate-y-1/2 group-hover:opacity-60"
          aria-hidden="true"
        />
      )}
    </button>
  )
})
