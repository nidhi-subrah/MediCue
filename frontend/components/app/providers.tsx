'use client'

import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useSettings } from '@/lib/store/settings'
import { AuthProvider } from './auth-provider'
import { OfflineBanner } from './offline-banner'
import { SwRegister } from './sw-register'
import { UrgentOverlay } from './urgent-overlay'

function useApplySettings() {
  const textSize = useSettings((s) => s.textSize)
  const buttonSize = useSettings((s) => s.buttonSize)
  const highContrast = useSettings((s) => s.highContrast)
  const reducedMotion = useSettings((s) => s.reducedMotion)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.textSize = textSize
    root.dataset.buttonSize = buttonSize
    root.classList.toggle('high-contrast', highContrast)
    root.classList.toggle('reduce-motion', reducedMotion)
  }, [textSize, buttonSize, highContrast, reducedMotion])
}

function rehydrate(store: { persist?: { rehydrate: () => unknown } }) {
  try {
    void store.persist?.rehydrate()
  } catch {
    // Storage can be blocked inside embedded previews; defaults are used instead.
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const reducedMotion = useSettings((s) => s.reducedMotion)
  useApplySettings()

  useEffect(() => {
    rehydrate(useSettings)

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'silentsignal-settings') rehydrate(useSettings)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      <AuthProvider>
        <SwRegister />
        <OfflineBanner />
        {children}
        <UrgentOverlay />
      </AuthProvider>
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast:
              '!rounded-2xl !border-border !bg-card !text-card-foreground !font-sans !text-base !shadow-lg',
            actionButton: '!bg-primary !text-primary-foreground !rounded-lg',
          },
        }}
      />
    </MotionConfig>
  )
}
