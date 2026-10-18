'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, useChannel } from '@/lib/services/backend'
import type { Alert, PatientTrend, ProfileSuggestion } from '@/lib/types'

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
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([])

  const loadTrends = useCallback(() => api.get<PatientTrend[]>('/api/trends').then(setTrends), [])
  // The whole list from the backend, replacing what's on screen: on load and on every reconnect.
  const loadAlerts = useCallback(() => api.get<Alert[]>('/api/alerts').then(setAlerts).catch(() => {}), [])

  useEffect(() => {
    void loadAlerts()
    api.get<ProfileSuggestion[]>('/api/suggestions').then(setSuggestions)
    void loadTrends()
    const t = window.setInterval(loadTrends, 60000)
    return () => window.clearInterval(t)
  }, [loadTrends, loadAlerts])

  useChannel('nurse', (m) => {
    if (m.type === 'alert') {
      setAlerts((a) => [m.alert, ...a.filter((x) => x.id !== m.alert.id)])
      if (m.alert.priority === 'urgent') beep()
    }
    if (m.type === 'alert_updated') {
      setAlerts((a) => a.map((x) => (x.id === m.alert.id ? m.alert : x)))
      if (m.alert.status === 'confirmed') void loadTrends()
    }
    if (m.type === 'case') {
      // Clinician copilot: a case packet (or its Gemini wording, or the nurse's feedback) for an alert.
      setAlerts((a) => a.map((x) => (x.id === m.case.alert_id ? { ...x, case: m.case } : x)))
    }
    if (m.type === 'suggestions') {
      // Gemini's profile suggestions from a nurse's note, or a review result: upsert, newest first.
      setSuggestions((all) => {
        const ids = new Set(m.suggestions.map((s) => s.id))
        return [...m.suggestions, ...all.filter((s) => !ids.has(s.id))].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        )
      })
    }
  }, loadAlerts)

  /** `note` is the nurse's optional observation; Gemini proposes profile changes from it for approval.
   *  `caseHelpful` is the verdict on the alert's case packet, if it has one. */
  const confirm = useCallback(async (alertId: string, needId: string | null, note: string | null,
                                     caseHelpful: boolean | null = null) => {
    try {
      await api.post(`/api/alerts/${alertId}/confirm`, { need_id: needId, note, case_helpful: caseHelpful })
    } catch {
      // Already handled at another station, or gone after a backend restart: show the real list, and say so.
      toast('That request is no longer open', { description: 'The list has been refreshed.' })
      void loadAlerts()
    }
  }, [loadAlerts])

  const reviewSuggestion = useCallback(async (id: string, approve: boolean) => {
    const s = await api.post<ProfileSuggestion>(`/api/suggestions/${id}/review`, { approve })
    setSuggestions((all) => all.map((x) => (x.id === s.id ? s : x)))
  }, [])

  return { alerts, trends, suggestions, confirm, reviewSuggestion }
}
