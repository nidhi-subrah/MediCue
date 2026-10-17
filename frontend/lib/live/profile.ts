'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { HandoffSummary, Patient, PatientProfile } from '@/lib/types'

/** A patient's chart notes and the profile Gemini read from them. Saving notes re-reads them; the
 *  backend pushes the finished profile on the nurse channel when extraction completes. */
export function usePatientProfile(patientId: string) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [profile, setProfile] = useState<PatientProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Patient>(`/api/patients/${patientId}`).then(setPatient).catch((e) => setError(String(e)))
    api.get<PatientProfile>(`/api/patients/${patientId}/profile`).then(setProfile).catch((e) => setError(String(e)))
  }, [patientId])

  useChannel('nurse', (m) => {
    if (m.type === 'profile' && m.profile.patient_id === patientId) setProfile(m.profile)
  })

  const saveNotes = useCallback(
    async (notes: string) => {
      setError(null)
      try {
        setProfile(await api.post<PatientProfile>(`/api/patients/${patientId}/notes`, { notes }))
      } catch (e) {
        setError(String(e))
      }
    },
    [patientId],
  )

  return { patient, profile, error, saveNotes }
}

/** The fixed-structure shift handoff. Numbers come from the backend; Gemini only writes headlines. */
export function useHandoff(hours = 12) {
  const [summary, setSummary] = useState<HandoffSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<HandoffSummary>(`/api/handoff?hours=${hours}`).then(setSummary).catch((e) => setError(String(e)))
  }, [hours])

  return { summary, error }
}
