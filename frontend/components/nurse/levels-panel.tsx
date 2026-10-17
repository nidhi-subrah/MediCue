'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { LadderChange, LadderLevel, LadderPatient } from '@/lib/types'
import { cn } from '@/lib/utils'

const time = (c: LadderChange) =>
  new Date(c.at ?? c.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Communication ladder per patient (backend/app/engine/ladder.py): the level each bedside tablet is at,
 *  and why it changed this shift, e.g. "Full → Yes / No at 14:02 (answers 2.4× slower than usual)". */
export function LevelsPanel() {
  const [rows, setRows] = useState<LadderPatient[]>([])
  const load = useCallback(() => api.get<LadderPatient[]>('/api/ladder').then(setRows).catch(() => {}), [])

  useEffect(() => {
    void load()
  }, [load])

  useChannel('nurse', (m) => {
    if (m.type !== 'level_changed') return
    // A Gemini explanation arrives as a second message with the same change id: merge, don't duplicate.
    setRows((all) => {
      const known = all.find((r) => r.patient_id === m.patient_id)
      if (!known) {
        void load()
        return all
      }
      return all.map((r) => {
        if (r.patient_id !== m.patient_id) return r
        const seen = r.changes.some((c) => c.id === m.change.id)
        return {
          ...r,
          level: m.change.to,
          label: m.change.to_label,
          active: true,
          changes: seen ? r.changes.map((c) => (c.id === m.change.id ? m.change : c)) : [...r.changes, m.change],
        }
      })
    })
  })

  const setLevel = async (r: LadderPatient, level: LadderLevel) => {
    if (!r.session_id) return
    await api.post(`/api/sessions/${r.session_id}/level`, { level, by: 'nurse' })
  }

  if (rows.length === 0) return null

  return (
    <section aria-labelledby="levels-h" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 id="levels-h" className="text-xl font-bold">How patients are answering</h2>
        <p className="text-sm text-muted-foreground">
          Tablets simplify themselves when answering gets harder, and step back up when it gets easier
        </p>
      </header>
      {rows.map((r) => (
        <article key={r.patient_id} className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5">
          <header className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{r.room}</span>
            <span className="font-semibold">{r.patient_name}</span>
            {r.level && (
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  r.level >= 3 ? 'bg-urgent-soft text-urgent' : r.level === 2 ? 'bg-primary-soft text-primary' : 'bg-muted',
                )}
              >
                {r.label}
              </span>
            )}
            {r.active && r.level && (
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  disabled={r.level >= 4}
                  onClick={() => setLevel(r, (r.level! + 1) as LadderLevel)}
                  className="h-9 rounded-full border border-border px-3 text-sm font-semibold hover:border-primary/40 disabled:opacity-40"
                >
                  Easier
                </button>
                <button
                  type="button"
                  disabled={r.level <= 1}
                  onClick={() => setLevel(r, (r.level! - 1) as LadderLevel)}
                  className="h-9 rounded-full border border-border px-3 text-sm font-semibold hover:border-primary/40 disabled:opacity-40"
                >
                  More choices
                </button>
              </span>
            )}
          </header>
          {r.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes this shift.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {r.changes.slice(-5).map((c, i) => (
                <li key={c.id ?? i} className="border-l-4 border-border pl-3 text-sm">
                  <span className="font-semibold">
                    {c.from_label} → {c.to_label}
                  </span>{' '}
                  at {time(c)}{' '}
                  <span className="text-muted-foreground">({c.reason})</span>
                  {c.explanation && <p className="text-muted-foreground italic">{c.explanation}</p>}
                </li>
              ))}
            </ol>
          )}
        </article>
      ))}
    </section>
  )
}
