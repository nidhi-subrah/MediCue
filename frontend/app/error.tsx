'use client'

import { useEffect } from 'react'
import { FallbackScreen } from '@/components/app/fallback-screen'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[SilentSignal] screen failed, showing fallback:', error)
  }, [error])

  return <FallbackScreen onRetry={reset} />
}
