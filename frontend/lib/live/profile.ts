'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { HandoffSummary, LearningDemo, Patient, PatientLearning, PatientProfile } from '@/lib/types'

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

/** What this patient's own gestures have come to mean, plus the replay demo. */
export function usePatientLearning(patientId: string) {
  const [learning, setLearning] = useState<PatientLearning | null>(null)
  const [demo, setDemo] = useState<LearningDemo | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () => api.get<PatientLearning>(`/api/patients/${patientId}/learning`).then(setLearning).catch((e) => setError(String(e))),
    [patientId],
  )
  useEffect(() => {
    void load()
  }, [load])

  // A nurse confirming one of this patient's alerts is exactly what teaches the engine: refresh then.
  useChannel('nurse', (m) => {
    if (m.type === 'alert_updated' && m.alert.patient_id === patientId && m.alert.status === 'confirmed') void load()
  })

  const runDemo = useCallback(
    async (area: string, feeling: string, need: string, sessions = 5) => {
      setRunning(true)
      setError(null)
      try {
        setDemo(await api.post<LearningDemo>(`/api/patients/${patientId}/learning/demo`, { area, feeling, need, sessions }))
      } catch (e) {
        setError(String(e))
      } finally {
        setRunning(false)
      }
    },
    [patientId],
  )

  return { learning, demo, running, error, runDemo }
}
