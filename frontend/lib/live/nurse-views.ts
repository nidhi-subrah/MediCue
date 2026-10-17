'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/services/backend'
import type { CareForecast, InsightsCell, UnitInsights } from '@/lib/types'

const REFRESH_MS = 60_000

/** Unit insights (the past). Refreshes every minute while open. */
export function useUnitInsights(range: UnitInsights['range'], timelineHours: number) {
  const [data, setData] = useState<UnitInsights | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.get<UnitInsights>(`/api/nurse/insights?range=${range}&timeline_hours=${timelineHours}`))
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [range, timelineHours])

  useEffect(() => {
    void load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(t)
  }, [load])

  return { data, error }
}

export function useInsightsCell() {
  const [cell, setCell] = useState<InsightsCell | null>(null)
  const open = useCallback(async (patientId: string, start: string, bucket: string) => {
    const qs = new URLSearchParams({ patient_id: patientId, start, bucket })
    setCell(await api.get<InsightsCell>(`/api/nurse/insights/cell?${qs}`))
  }, [])
  return { cell, open, close: () => setCell(null) }
}

/** Care forecast (ahead). While Gemini's adjustment is still being prepared ("pending"), checks again
 *  shortly; otherwise refreshes every minute. */
export function useCareForecast() {
  const [data, setData] = useState<CareForecast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    window.clearTimeout(timer.current)
    try {
      const f = await api.get<CareForecast>('/api/nurse/forecast')
      setData(f)
      setError(null)
      timer.current = window.setTimeout(load, f.source === 'pending' ? 4_000 : REFRESH_MS)
    } catch (e) {
      setError(String(e))
      timer.current = window.setTimeout(load, REFRESH_MS)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => window.clearTimeout(timer.current)
  }, [load])

  return { data, error }
}
