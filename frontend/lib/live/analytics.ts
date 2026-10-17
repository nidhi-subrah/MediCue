'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/services/backend'
import type { BeliefEvolutionPoint, DecisionActionRow, Patient, TigerDataOverview } from '@/lib/types'

export function useTigerDataOverview(patientId: string | null) {
  const [overview, setOverview] = useState<TigerDataOverview | null>(null)
  const [patients, setPatients] = useState<Patient[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : ''
      setOverview(await api.get<TigerDataOverview>(`/api/analytics/tigerdata${qs}`))
    } catch (e) {
      setError(String(e))
    }
  }, [patientId])

  useEffect(() => {
    void load()
    api.get<Patient[]>('/api/patients').then(setPatients).catch(() => {})
  }, [load])

  return { overview, patients, error, reload: load }
}

export function useDecisionTrace(sessionId: string | null) {
  const [actions, setActions] = useState<DecisionActionRow[]>([])
  const [belief, setBelief] = useState<BeliefEvolutionPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sessionId) {
      setActions([])
      setBelief([])
      return
    }
    setLoading(true)
    setError(null)
    api
      .get<{ decision_actions: DecisionActionRow[]; belief_evolution: BeliefEvolutionPoint[] }>(
        `/api/analytics/sessions/${sessionId}/decision-trace`,
      )
      .then((r) => {
        setActions(r.decision_actions)
        setBelief(r.belief_evolution)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [sessionId])

  return { actions, belief, error, loading }
}
