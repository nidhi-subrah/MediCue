'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useSettings } from './settings'

type PersistApi = {
  hasHydrated?: () => boolean
  onFinishHydration?: (fn: () => void) => () => void
}

function persistApis(): PersistApi[] {
  return [(useSettings as unknown as { persist?: PersistApi }).persist].filter((api): api is PersistApi => Boolean(api))
}

function subscribe(callback: () => void) {
  const unsubs = persistApis().map((api) => {
    try {
      return api.onFinishHydration?.(callback) ?? (() => {})
    } catch {
      return () => {}
    }
  })
  return () => unsubs.forEach((u) => u())
}

function getSnapshot() {
  try {
    return persistApis().every((api) => api.hasHydrated?.() ?? true)
  } catch {
    return true
  }
}

const HYDRATION_TIMEOUT_MS = 800

// Saved data is a nice-to-have: if storage is blocked (e.g. inside a preview iframe)
// or the store isn't ready, the app still renders with defaults after a short wait.
export function useHydrated() {
  const storeHydrated = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (storeHydrated) return
    const id = window.setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [storeHydrated])

  return storeHydrated || timedOut
}
