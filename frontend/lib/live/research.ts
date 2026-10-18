'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { Patient, ResearchDigest, ResearchHypothesis, ResearchInquiry, StaffMember } from '@/lib/types'

/** What one research cycle did, counted from the data before and after it (nothing estimated). */
export interface CycleSummary {
  at: string
  created: number           // new hypotheses the detectors proposed
  investigated: number      // hypotheses with new timeline entries
  dataChecks: number        // CHECK_DATA actions taken
  inquiries: number         // new questions for clinicians
  confidenceUpdates: number // confidence changes recorded
  statusChanges: number     // status changes recorded (e.g. to pending review)
  waits: number             // WAIT chosen where it wasn't the last action already
}

export type CycleResult = { ok: true; summary: CycleSummary } | { ok: false; error: string }

function summarize(before: ResearchHypothesis[], after: ResearchHypothesis[], inquiriesBefore: ResearchInquiry[],
                   inquiriesAfter: ResearchInquiry[]): CycleSummary {
  const old = new Map(before.map((h) => [h.id, h.timeline.length]))
  const entries = after.flatMap((h) => h.timeline.slice(old.get(h.id) ?? 0))
  const asked = new Set(inquiriesBefore.map((i) => i.id))
  return {
    at: new Date().toISOString(),
    created: after.filter((h) => !old.has(h.id)).length,
    investigated: after.filter((h) => h.timeline.length > (old.get(h.id) ?? 0)).length,
    dataChecks: entries.filter((t) => t.kind === 'action' && t.text.startsWith('CHECK_DATA')).length,
    inquiries: inquiriesAfter.filter((i) => !asked.has(i.id)).length,
    confidenceUpdates: entries.filter((t) => t.kind === 'confidence').length,
    statusChanges: entries.filter((t) => t.kind === 'status').length,
    waits: entries.filter((t) => t.kind === 'action' && t.text.startsWith('WAIT')).length,
  }
}

export function useResearch() {
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([])
  const [inquiries, setInquiries] = useState<ResearchInquiry[]>([])
  const [digest, setDigest] = useState<ResearchDigest | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)   // a second click before React re-renders must not start a second cycle

  const load = useCallback(async () => {
    try {
      const [h, i, d] = await Promise.all([
        api.get<ResearchHypothesis[]>('/api/research/hypotheses'),
        api.get<ResearchInquiry[]>('/api/research/inquiries?status=pending'),
        api.get<ResearchDigest>('/api/research/digest'),
      ])
      setHypotheses(h)
      setInquiries(i)
      setDigest(d)
      setError(null)
      return { h, i }
    } catch (e) {
      setError(String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    api.get<{ staff: StaffMember[] }>('/api/research/clinicians').then((r) => setStaff(r.staff)).catch(() => {})
    api.get<Patient[]>('/api/patients').then(setPatients).catch(() => {})
  }, [load])

  useChannel('research', (m) => {
    if (m.type === 'research_updated') void load()
  }, load)

  const runCycle = useCallback(async (): Promise<CycleResult | null> => {
    if (runningRef.current) return null
    runningRef.current = true
    setRunning(true)
    const before = hypotheses
    const inquiriesBefore = inquiries
    try {
      const after = await api.post<ResearchHypothesis[]>('/api/research/cycle')
      const fresh = await load()
      return { ok: true, summary: summarize(before, after, inquiriesBefore, fresh?.i ?? inquiriesBefore) }
    } catch (e) {
      return { ok: false, error: String(e) }
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [hypotheses, inquiries, load])

  // Each action resolves only once the server has saved it, then reloads; errors reach the caller.
  const reviewHypothesis = useCallback(
    async (id: string, decision: 'validated' | 'rejected' | 'needs_more_data', note: string | null) => {
      await api.post(`/api/research/hypotheses/${id}/review`, { decision, note })
      await load()
    },
    [load],
  )

  const answerInquiry = useCallback(
    async (id: string, response: 'agree' | 'disagree' | 'unsure', note: string | null) => {
      await api.post(`/api/research/inquiries/${id}/answer`, { response, note })
      await load()
    },
    [load],
  )

  const submitObservation = useCallback(
    async (text: string, clinicianId: string, patientId: string | null) => {
      const h = await api.post<ResearchHypothesis>('/api/research/observations',
                                                   { text, clinician_id: clinicianId, patient_id: patientId })
      await load()
      return h
    },
    [load],
  )

  return { hypotheses, inquiries, digest, staff, patients, loading, error, running, runCycle, reviewHypothesis,
           answerInquiry, submitObservation }
}
