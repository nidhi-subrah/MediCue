'use client'

import { forwardRef } from 'react'
import type { ChoiceItem } from '@/lib/types'
import { cn } from '@/lib/utils'

type Size = 'regular' | 'large' | 'huge'   // huge: ladder level 3+, one yes/no at a time

const toneClasses: Record<NonNullable<ChoiceItem['tone']>, { card: string; chip: string }> = {
  default: {
    card: 'border-border bg-card hover:border-primary/40 hover:bg-primary-soft/60',
    chip: 'bg-primary-soft text-primary',
  },
  primary: {
    card: 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
    chip: 'bg-primary-foreground/15 text-primary-foreground',
  },
  urgent: {
    card: 'border-urgent/30 bg-urgent-soft hover:border-urgent/60',
    chip: 'bg-urgent text-urgent-foreground',
  },
  unsure: {
    card: 'border-dashed border-border bg-surface hover:border-primary/40',
    chip: 'bg-card text-muted-foreground',
  },
  control: {
    card: 'border-border bg-surface hover:bg-muted',
    chip: 'bg-card text-foreground',
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
      onClick={item.onSelect}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={item.selected || undefined}
      data-highlighted={highlighted || undefined}
      className={cn(
        'group relative flex w-full items-center gap-4 rounded-2xl border-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-soft active:translate-y-0 active:scale-[0.98]',
        !highlighted && 'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10',
        tone.card,
        huge ? 'min-h-32 justify-center p-6' : large ? 'min-h-24 p-5' : 'min-tap p-4',
        highlighted &&
          'z-10 border-primary bg-primary-soft shadow-[0_0_0_4px_var(--color-primary-soft),0_0_0_6px_var(--color-primary)]',
        item.tone === 'urgent' && highlighted && 'border-urgent shadow-[0_0_0_4px_var(--color-urgent-soft),0_0_0_6px_var(--color-urgent)]',
      )}
    >
      {number !== undefined && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-xl border border-border bg-background font-mono font-bold text-foreground',
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
            'inline-flex shrink-0 items-center justify-center rounded-xl',
            tone.chip,
            large ? 'size-14' : 'size-11',
          )}
          aria-hidden="true"
        >
          <Icon className={large ? 'size-7' : 'size-5'} />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className={cn('font-semibold leading-snug text-pretty', huge ? 'text-4xl' : large ? 'text-2xl' : 'text-lg')}>
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
    </button>
  )
})
