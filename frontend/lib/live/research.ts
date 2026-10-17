'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { Patient, ResearchDigest, ResearchHypothesis, ResearchInquiry, StaffMember } from '@/lib/types'

export function useResearch() {
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([])
  const [inquiries, setInquiries] = useState<ResearchInquiry[]>([])
  const [digest, setDigest] = useState<ResearchDigest | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    const [h, i, d] = await Promise.all([
      api.get<ResearchHypothesis[]>('/api/research/hypotheses'),
      api.get<ResearchInquiry[]>('/api/research/inquiries?status=pending'),
      api.get<ResearchDigest>('/api/research/digest'),
    ])
    setHypotheses(h)
    setInquiries(i)
    setDigest(d)
  }, [])

  useEffect(() => {
    void load()
    api.get<{ staff: StaffMember[] }>('/api/research/clinicians').then((r) => setStaff(r.staff))
    api.get<Patient[]>('/api/patients').then(setPatients)
  }, [load])

  useChannel('research', (m) => {
    if (m.type === 'research_updated') void load()
  })

  const runCycle = useCallback(async () => {
    setRunning(true)
    try {
      await api.post('/api/research/cycle')
      await load()
    } finally {
      setRunning(false)
    }
  }, [load])

  const reviewHypothesis = useCallback(
    (id: string, decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) =>
      api.post(`/api/research/hypotheses/${id}/review`, { decision, note }),
    [],
  )

  const answerInquiry = useCallback(
    (id: string, response: 'agree' | 'disagree' | 'unsure', note: string | null) =>
      api.post(`/api/research/inquiries/${id}/answer`, { response, note }),
    [],
  )

  const submitObservation = useCallback(
    (text: string, clinicianId: string, patientId: string | null) =>
      api.post<ResearchHypothesis>('/api/research/observations', { text, clinician_id: clinicianId, patient_id: patientId }),
    [],
  )

  return { hypotheses, inquiries, digest, staff, patients, running, runCycle, reviewHypothesis, answerInquiry, submitObservation }
}
