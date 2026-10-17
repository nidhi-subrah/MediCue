'use client'

import { useEffect } from 'react'

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a nice-to-have; failures here shouldn't block the app.
    })
  }, [])

  return null
}
