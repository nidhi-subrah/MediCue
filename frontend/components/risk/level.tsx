import { CircleMinus, Eye, TriangleAlert } from 'lucide-react'
import type { RiskFlagLevel } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Each level has its own shape and word; colour only reinforces it. */
export const LEVEL: Record<RiskFlagLevel, { label: string; icon: typeof Eye; rank: number; text: string; edge: string }> = {
  low: { label: 'Low', icon: CircleMinus, rank: 0, text: 'text-muted-foreground', edge: 'border-l-border' },
  watch: { label: 'Watch', icon: Eye, rank: 1, text: 'text-caution', edge: 'border-l-caution' },
  elevated: { label: 'Elevated', icon: TriangleAlert, rank: 2, text: 'text-urgent', edge: 'border-l-urgent' },
}

export function LevelBadge({ level, enough = true, className }: { level: RiskFlagLevel; enough?: boolean; className?: string }) {
  const { label, icon: Icon, text } = LEVEL[level]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', text, className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
      {!enough && <span className="font-normal text-muted-foreground"> · data gap</span>}
    </span>
  )
}

export function SyntheticTag({ children = 'Synthetic data' }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border px-1.5 font-mono text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}
