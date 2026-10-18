import Link from 'next/link'
import { cn } from '@/lib/utils'

/** The MediCue mark: a speech bubble (communication) carrying a small cross (care). Same drawing as
 *  public/icon.svg and the app icons. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 180"
      aria-hidden="true"
      className={cn('size-9 shrink-0', className)}
    >
      <rect width="180" height="180" rx="40" className="fill-primary" />
      <path
        d="M44 50a14 14 0 0 1 14-14h64a14 14 0 0 1 14 14v52a14 14 0 0 1-14 14H84l-24 22v-22h-2a14 14 0 0 1-14-14z"
        className="fill-primary-foreground"
      />
      <path d="M82 56h16v14h14v16H98v14H82V86H68V70h14z" className="fill-primary" />
    </svg>
  )
}

/** `compact`: show only the mark below the lg breakpoint (tablets), so the nav fits on one line. */
export function Brand({ href = '/home', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5 rounded-xl text-foreground" aria-label="MediCue home">
      <BrandMark />
      <span className={cn('text-lg font-bold tracking-tight', compact && 'hidden lg:inline')}>
        Medi<span className="text-primary">Cue</span>
      </span>
    </Link>
  )
}
