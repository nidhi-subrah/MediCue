'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { ConsultRequest, SilenceLadder } from '@/lib/types'

export interface PersonInfo {
  id: string
  name: string
  relation: string
  patient_id: string
  patient_name: string
}

export function useFamilyData(personId: string) {
  const [me, setMe] = useState<PersonInfo | null>(null)
  const [consults, setConsults] = useState<ConsultRequest[]>([])
  const [welfare, setWelfare] = useState<{ id: string; status: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<SilenceLadder[]>([])
  const upsertCheck = useCallback((l: SilenceLadder) => setChecks((all) => [l, ...all.filter((x) => x.id !== l.id)]), [])

  useEffect(() => {
    api.get<SilenceLadder[]>(`/api/risk/silence/ladders?person_id=${personId}&active=true`).then(setChecks).catch(() => {})
    api.get<PersonInfo>(`/api/people/${personId}`).then(setMe).catch((e) => setError(String(e)))
    api.get<ConsultRequest[]>(`/api/consults?person_id=${personId}`).then(setConsults)
  }, [personId])

  useChannel(`family:${personId}`, (m) => {
    if (m.type === 'consult') setConsults((c) => [m.consult, ...c.filter((x) => x.id !== m.consult.id)])
    if (m.type === 'welfare_resolved') setWelfare((w) => (w?.id === m.id ? { id: m.id, status: m.outcome } : w))
    if (m.type === 'silence_check') upsertCheck(m.ladder)
  })

  const answer = useCallback(async (c: ConsultRequest, needId: string | null, unsure = false) => {
    const updated = await api.post<ConsultRequest>(`/api/consults/${c.id}/answer`, { need_id: needId, unsure })
    setConsults((all) => all.map((x) => (x.id === c.id ? updated : x)))
  }, [])

  const checkIn = useCallback(async () => {
    if (!me) return
    try {
      const w = await api.post<{ id: string; status: string }>('/api/welfare', { patient_id: me.patient_id, requested_by: personId })
      setWelfare(w)
    } catch (e) {
      setError(String(e))
    }
  }, [me, personId])

  return { me, consults, welfare, error, answer, checkIn, checks, upsertCheck }
}
