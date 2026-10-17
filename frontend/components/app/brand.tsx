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

export function Brand({ href = '/home' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-xl text-foreground"
      aria-label="SilentSignal home"
    >
      <BrandMark />
      <span className="text-lg font-bold tracking-tight">SilentSignal</span>
    </Link>
  )
}
