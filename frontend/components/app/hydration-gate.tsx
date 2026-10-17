'use client'

import { useHydrated } from '@/lib/store/hydration'

export function HydrationGate({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated()
  if (!hydrated) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        <div className="h-10 w-2/3 animate-pulse rounded-xl bg-muted" />
        <div className="h-5 w-1/2 animate-pulse rounded-lg bg-muted" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }
  return <>{children}</>
}
