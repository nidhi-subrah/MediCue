'use client'

import { useState } from 'react'
import { useDecisionTrace } from '@/lib/live/analytics'
import type { PatientAnalytics } from '@/lib/types'
import { cn } from '@/lib/utils'

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export function DecisionTrace({ patient }: { patient: PatientAnalytics }) {
  const [sessionId, setSessionId] = useState<string | null>(patient.recent_sessions[0]?.session_id ?? null)
  const { actions, belief, loading, error } = useDecisionTrace(sessionId)

  const cycles = Array.from(new Set(actions.map((a) => a.decision_cycle)))

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Decision trace</h2>
        {patient.recent_sessions.length > 0 ? (
          <select
            value={sessionId ?? ''}
            onChange={(e) => setSessionId(e.target.value || null)}
            className="min-h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {patient.recent_sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id} · {timeAgo(s.time)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">No sessions recorded yet</span>
        )}
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-urgent">{error}</p>}

      {!loading && sessionId && cycles.length === 0 && (
        <p className="text-sm text-muted-foreground">No decision candidates recorded for this session.</p>
      )}

      {cycles.map((cycle) => {
        const rows = actions.filter((a) => a.decision_cycle === cycle).sort((a, b) => a.rank - b.rank)
        return (
          <div key={cycle} className="flex flex-col gap-2">
            <p className="font-mono text-xs text-muted-foreground">cycle {cycle} · {rows.length} candidates scored</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="border-b border-border pb-1 pr-2 font-medium">Action</th>
                    <th className="border-b border-border pb-1 pr-2 text-right font-medium">EIG</th>
                    <th className="border-b border-border pb-1 pr-2 text-right font-medium">Value</th>
                    <th className="border-b border-border pb-1 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={`${a.kind}-${a.action_id}`} className={cn(a.selected && 'font-semibold text-primary')}>
                      <td className="border-b border-border py-1 pr-2">
                        {a.selected && '→ '}{a.kind} · {a.label}
                      </td>
                      <td className="border-b border-border py-1 pr-2 text-right font-mono tabular-nums">
                        {a.eig?.toFixed(3) ?? '—'}
                      </td>
                      <td className="border-b border-border py-1 pr-2 text-right font-mono tabular-nums">{a.value.toFixed(2)}</td>
                      <td className="border-b border-border py-1 text-right font-mono tabular-nums">{a.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {belief.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer text-primary">Belief evolution ({belief.length} points)</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {belief.slice(-20).map((b, i) => (
              <li key={i} className="flex justify-between gap-2 border-b border-border py-1 text-xs">
                <span>step {b.step} · {b.label}</span>
                <span className="font-mono tabular-nums">{(b.prob * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
