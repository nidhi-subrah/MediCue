'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/services/backend'
import type { Finding } from '@/lib/types'

export function useResearch() {
  const [findings, setFindings] = useState<Finding[]>([])
  const [running, setRunning] = useState(false)

  const load = useCallback(() => api.get<Finding[]>('/api/research/findings').then(setFindings), [])
  useEffect(() => void load(), [load])

  const run = useCallback(async () => {
    setRunning(true)
    try {
      await api.post('/api/research/run')
      await load()
    } finally {
      setRunning(false)
    }
  }, [load])

  const review = useCallback(async (f: Finding, status: Finding['status'], note: string | null) => {
    const updated = await api.post<Finding>(`/api/research/findings/${f.id}/review`, { status, note })
    setFindings((all) => all.map((x) => (x.id === f.id ? updated : x)))
  }, [])

  return { findings, running, run, review }
}
