import Link from 'next/link'
import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-9 items-end justify-center gap-[3px] rounded-xl bg-primary px-2 pb-2 pt-2.5',
        className,
      )}
    >
      <span className="h-2 w-1 rounded-full bg-primary-foreground/60" />
      <span className="h-4 w-1 rounded-full bg-primary-foreground" />
      <span className="h-3 w-1 rounded-full bg-primary-foreground/80" />
    </span>
  )
}

/** `compact`: show only the mark below the lg breakpoint (tablets), so the nav fits on one line. */
export function Brand({ href = '/home', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className="flex shrink-0 items-center gap-2.5 rounded-xl text-foreground"
      aria-label="SilentSignal home"
    >
      <BrandMark />
      <span className={cn('text-lg font-bold tracking-tight', compact && 'hidden lg:inline')}>SilentSignal</span>
    </Link>
  )
}
