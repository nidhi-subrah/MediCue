'use client'

import { Siren } from 'lucide-react'
import { useUrgent } from '@/lib/live/urgent'
import { cn } from '@/lib/utils'

export function UrgentButton({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const openUrgent = useUrgent((s) => s.openUrgent)

  return (
    <button
      type="button"
      onClick={() => openUrgent()}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full bg-urgent font-semibold text-urgent-foreground shadow-sm transition-colors hover:bg-urgent/90 focus-visible:outline-urgent',
        compact ? 'h-11 px-4 text-sm' : 'h-12 px-5 text-base',
        className,
      )}
    >
      <Siren className="size-5" aria-hidden="true" />
      <span>Urgent help</span>
    </button>
  )
}
