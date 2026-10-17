'use client'

import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/use-online-status'

export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-urgent px-4 py-2 text-center text-sm font-semibold text-urgent-foreground"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      You&apos;re offline — messages, alerts, and live data won&apos;t go through until you reconnect.
    </div>
  )
}
