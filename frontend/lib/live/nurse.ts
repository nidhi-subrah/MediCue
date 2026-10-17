'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { Alert, PatientTrend } from '@/lib/types'

function beep() {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    o.frequency.value = 880
    o.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.25)
  } catch {
    // audio blocked until the user interacts with the page
  }
}

export function useNurseStation() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [trends, setTrends] = useState<PatientTrend[]>([])

  const loadTrends = useCallback(() => api.get<PatientTrend[]>('/api/trends').then(setTrends), [])

  useEffect(() => {
    api.get<Alert[]>('/api/alerts').then(setAlerts)
    void loadTrends()
    const t = window.setInterval(loadTrends, 60000)
    return () => window.clearInterval(t)
  }, [loadTrends])

  useChannel('nurse', (m) => {
    if (m.type === 'alert') {
      setAlerts((a) => [m.alert, ...a.filter((x) => x.id !== m.alert.id)])
      if (m.alert.priority === 'urgent') beep()
    }
    if (m.type === 'alert_updated') {
      setAlerts((a) => a.map((x) => (x.id === m.alert.id ? m.alert : x)))
      if (m.alert.status === 'confirmed') void loadTrends()
    }
  })

  const confirm = useCallback(async (alertId: string, needId: string | null) => {
    await api.post(`/api/alerts/${alertId}/confirm`, { need_id: needId })
  }, [])

  return { alerts, trends, confirm }
}
