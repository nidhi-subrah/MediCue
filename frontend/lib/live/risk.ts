'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { Forecast, Patient, RiskOverview, SilenceLadder, Timeline, TimelineCase } from '@/lib/types'

/** Latest risk per patient (synthetic cohort + demo patients), refreshed every 5 minutes. */
export function useRiskOverview() {
  const [data, setData] = useState<RiskOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = () => api.get<RiskOverview>('/api/risk/patients').then(setData).catch((e) => setError(String(e)))
    void load()
    const t = window.setInterval(load, 5 * 60000)
    return () => window.clearInterval(t)
  }, [])

  return { data, error }
}

/** Early warnings: refreshed every 5 minutes, and once more shortly after Gemini starts writing the summary. */
export function useForecast() {
  const [data, setData] = useState<Forecast | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let follow: number | undefined
    let tries = 0   // Gemini may stay unavailable: follow up a few times, then wait for the next refresh
    const load = () =>
      api.get<Forecast>('/api/risk/forecast')
        .then((f) => {
          setData(f)
          window.clearTimeout(follow)
          if (f.ai_pending && tries++ < 3) follow = window.setTimeout(load, 8000)
        })
        .catch((e) => setError(String(e)))
    void load()
    const t = window.setInterval(load, 5 * 60000)
    return () => {
      window.clearInterval(t)
      window.clearTimeout(follow)
    }
  }, [])

  return { data, error }
}

/** Synthetic storylines with their lead times, and one storyline's full timeline. */
export function useLeadTimeline() {
  const [cases, setCases] = useState<TimelineCase[]>([])
  const [patientId, setPatientId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ cases: TimelineCase[] }>('/api/risk/timeline')
      .then((r) => {
        setCases(r.cases)
        // Default to the fall storyline whose flag fired earliest: the headline case for the demo.
        const falls = r.cases.filter((c) => c.risk === 'fall' && c.lead_days !== null)
          .sort((a, b) => (b.lead_days ?? 0) - (a.lead_days ?? 0))
        setPatientId((falls[0] ?? r.cases[0])?.patient_id ?? null)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (patientId) api.get<Timeline>(`/api/risk/timeline/${patientId}`).then(setTimeline).catch((e) => setError(String(e)))
  }, [patientId])

  return { cases, patientId, setPatientId, timeline, error }
}

export const NURSE_STATION = 'Nurse station'

/** Inactivity checks (silence detection, mode B), live over the nurse channel. */
export function useSilenceLadders() {
  const [ladders, setLadders] = useState<SilenceLadder[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<SilenceLadder[]>('/api/risk/silence/ladders').then(setLadders).catch((e) => setError(String(e)))
    api.get<Patient[]>('/api/patients').then(setPatients).catch(() => {})
  }, [])

  useChannel('nurse', (m) => {
    if (m.type === 'silence_check') setLadders((all) => [m.ladder, ...all.filter((x) => x.id !== m.ladder.id)])
  })

  const start = useCallback(async (patientId: string) => {
    setError(null)
    try {
      await api.post('/api/risk/silence/ladders', { patient_id: patientId })
    } catch (e) {
      setError(String(e))
    }
  }, [])

  /** A nurse who has checked in person closes every step of the check. */
  const acknowledge = useCallback(async (l: SilenceLadder) => {
    await api.post(`/api/risk/silence/ladders/${l.id}/ack`, { step: l.current, role: 'nurse', actor: NURSE_STATION })
  }, [])

  return { ladders, patients, error, start, acknowledge }
}

/** The trusted contact's answer: "ok" closes the check, "concern" alerts the nurse at once. */
export async function answerCheck(ladderId: string, personId: string, outcome: 'ok' | 'concern') {
  return api.post<SilenceLadder>(`/api/risk/silence/ladders/${ladderId}/ack`,
                                 { step: 'contact', role: 'contact', actor: personId, outcome })
}
