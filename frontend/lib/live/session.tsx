'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { ModeId, Patient, SessionState } from '@/lib/types'

interface Welfare { id: string; requestedBy: string; expiresIn: number; startedAt: number }

interface LiveSessionValue {
  patient: Patient | null
  session: SessionState | null
  error: string | null
  busy: boolean
  welfare: Welfare | null
  welfareSecondsLeft: number
  start: (mode?: ModeId) => Promise<void>
  tap: (kind: 'area' | 'feeling', tapId: string) => void
  answerQuestion: (answer: 'yes' | 'no' | 'unsure') => void
  setMode: (mode: ModeId) => void
  skipConsult: () => void
  respondWelfare: () => Promise<void>
}

const LiveSessionContext = createContext<LiveSessionValue | null>(null)

export function LiveSessionProvider({ patientId, children }: { patientId: string; children: ReactNode }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [welfare, setWelfare] = useState<Welfare | null>(null)
  const [now, setNow] = useState(Date.now())

  const start = useCallback(
    async (mode: ModeId = 'grid') => {
      setError(null)
      try {
        setSession(await api.post<SessionState>('/api/sessions', { patient_id: patientId, language: 'en', mode }))
      } catch (e) {
        setError(String(e))
      }
    },
    [patientId],
  )

  useEffect(() => {
    api.get<Patient>(`/api/patients/${patientId}`).then(setPatient).catch((e) => setError(String(e)))
    void start()
  }, [patientId, start])

  useChannel(`patient:${patientId}`, (m) => {
    if (m.type === 'session' && session && m.session.session_id === session.session_id) setSession(m.session)
    if (m.type === 'welfare_check') {
      setWelfare({ id: m.id, requestedBy: m.requested_by, expiresIn: m.expires_in, startedAt: Date.now() })
    }
    if (m.type === 'welfare_resolved') setWelfare(null)
  })

  useEffect(() => {
    if (!welfare) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [welfare])

  const act = useCallback(
    async (path: string, body: unknown) => {
      if (!session || busy) return
      setBusy(true)
      try {
        setSession(await api.post<SessionState>(`/api/sessions/${session.session_id}/${path}`, body))
      } catch (e) {
        setError(String(e))
      } finally {
        setBusy(false)
      }
    },
    [session, busy],
  )

  const value: LiveSessionValue = {
    patient,
    session,
    error,
    busy,
    welfare,
    welfareSecondsLeft: welfare ? Math.max(0, Math.ceil(welfare.expiresIn - (now - welfare.startedAt) / 1000)) : 0,
    start,
    tap: (kind, tapId) => void act('tap', { kind, tap_id: tapId }),
    answerQuestion: (answer) => {
      const q = session?.question
      if (q) void act('answer', { question_id: q.id, answer })
    },
    setMode: (mode) => void act('mode', { mode }),
    skipConsult: () => void act('skip_consult', {}),
    respondWelfare: async () => {
      if (!welfare) return
      await api.post(`/api/welfare/${welfare.id}/respond`)
      setWelfare(null)
    },
  }

  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>
}

export function useLiveSession() {
  const ctx = useContext(LiveSessionContext)
  if (!ctx) throw new Error('useLiveSession must be used within LiveSessionProvider')
  return ctx
}
