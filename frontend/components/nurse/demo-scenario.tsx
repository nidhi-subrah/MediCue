'use client'

import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/services/backend'
import type { DemoRun, DemoScenario } from '@/lib/types'

/** Plays a scripted, synthetic scenario through the real session service (backend/app/sim/demo_scenarios.py).
 *  Only the patient's inputs are scripted; every decision, the alert and the case packet are the engine's. */
export function DemoScenarioBar({ onAlert }: { onAlert: (alertId: string) => void }) {
  const [scenarios, setScenarios] = useState<DemoScenario[]>([])
  const [run, setRun] = useState<DemoRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<DemoScenario[]>('/api/demo/scenarios').then(setScenarios).catch(() => {})
  }, [])

  const play = async (sc: DemoScenario) => {
    setBusy(true)
    setError(null)
    setRun(null)
    try {
      const r = await api.post<DemoRun>(`/api/demo/scenarios/${sc.id}`, { pause_s: 0.4 })
      setRun(r)
      if (r.alert_id) onAlert(r.alert_id)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (scenarios.length === 0) return null
  return (
    <section aria-label="Demo scenarios" className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-border p-4">
      {scenarios.map((sc) => (
        <div key={sc.id} className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-border px-1.5 font-mono text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            Demo · synthetic
          </span>
          <span className="font-semibold">{sc.title}</span>
          <button type="button" onClick={() => play(sc)} disabled={busy}
                  className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border-2 border-primary bg-card px-4 text-sm font-semibold text-primary disabled:opacity-50">
            <Play className="size-4" aria-hidden="true" />{busy ? 'Playing…' : 'Play'}
          </button>
          <p className="w-full text-sm text-muted-foreground">{sc.description}</p>
        </div>
      ))}
      {run && (
        <ol className="flex flex-col gap-0.5 text-sm" aria-label="What the patient did">
          {run.steps.map((s, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span>{s.text}</span>
              <span className="font-mono text-muted-foreground">fatigue {s.fatigue.toFixed(2)}{s.mode === 'large' ? ' · large tiles' : ''}</span>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="text-sm text-urgent">{error}</p>}
    </section>
  )
}
