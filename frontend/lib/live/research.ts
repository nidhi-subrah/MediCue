'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, pct, useChannel } from '@/lib/services/backend'
import { STATUS_LABEL } from '@/components/research/hypothesis-card'
import type { Patient, ResearchDigest, ResearchHypothesis, ResearchInquiry, StaffMember } from '@/lib/types'

export function useResearch() {
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([])
  const [inquiries, setInquiries] = useState<ResearchInquiry[]>([])
  const [digest, setDigest] = useState<ResearchDigest | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [running, setRunning] = useState(false)

  const [notice, setNotice] = useState<string | null>(null)

  // Hypotheses and questions refresh immediately. The digest may wait on Gemini, so it loads on its own
  // and never holds up the rest of the page.
  const load = useCallback(async () => {
    api.get<ResearchDigest>('/api/research/digest').then(setDigest).catch(() => {})
    const [h, i] = await Promise.all([
      api.get<ResearchHypothesis[]>('/api/research/hypotheses'),
      api.get<ResearchInquiry[]>('/api/research/inquiries?status=pending'),
    ])
    setHypotheses(h)
    setInquiries(i)
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

  // Each action applies its own result and reloads, so the page updates even if the WebSocket is down.
  const reviewHypothesis = useCallback(
    async (id: string, decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) => {
      const h = await api.post<ResearchHypothesis>(`/api/research/hypotheses/${id}/review`, { decision, note })
      setHypotheses((all) => all.map((x) => (x.id === h.id ? h : x)))
      void load()
      return h
    },
    [load],
  )

  const answerInquiry = useCallback(
    async (id: string, response: 'agree' | 'disagree' | 'unsure', note: string | null) => {
      const h = await api.post<ResearchHypothesis>(`/api/research/inquiries/${id}/answer`, { response, note })
      const inq = inquiries.find((x) => x.id === id)
      setInquiries((all) => all.filter((x) => x.id !== id))
      setHypotheses((all) => all.map((x) => (x.id === h.id ? h : x)))
      const ev = [...h.evidence].reverse().find((e) => e.source === 'clinician')
      const moved =
        ev && response !== 'unsure'
          ? ` Confidence ${pct(ev.confidence_before)} → ${pct(ev.confidence_after)}.`
          : ' Confidence unchanged.'
      const verb = response === 'unsure' ? 'was unsure' : `${response}d`
      setNotice(`Recorded: ${inq?.clinician_name ?? 'Clinician'} ${verb} on “${h.statement}”${moved} Now: ${STATUS_LABEL[h.status].toLowerCase()}.`)
      void load()
      return h
    },
    [inquiries, load],
  )

  const submitObservation = useCallback(
    async (text: string, clinicianId: string, patientId: string | null) => {
      const h = await api.post<ResearchHypothesis>('/api/research/observations', {
        text,
        clinician_id: clinicianId,
        patient_id: patientId,
      })
      void load()
      return h
    },
    [load],
  )

  return {
    hypotheses,
    inquiries,
    digest,
    staff,
    patients,
    running,
    notice,
    dismissNotice: () => setNotice(null),
    runCycle,
    reviewHypothesis,
    answerInquiry,
    submitObservation,
  }
}
