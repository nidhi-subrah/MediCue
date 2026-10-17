'use client'

import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  hint?: string
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 4,
}: {
  label: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  columns?: 2 | 3 | 4
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', {
      'grid-cols-2': columns === 2,
      'grid-cols-3': columns === 3,
      'grid-cols-2 sm:grid-cols-4': columns === 4,
    })}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex min-h-12 flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-4 py-2 text-left transition-colors',
              active
                ? 'border-primary bg-primary-soft text-foreground'
                : 'border-border bg-card text-foreground hover:border-primary/40',
            )}
          >
            <span className="text-base font-semibold">{opt.label}</span>
            {opt.hint && <span className="text-sm text-muted-foreground">{opt.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
