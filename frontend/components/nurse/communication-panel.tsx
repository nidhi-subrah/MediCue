'use client'

import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { CommunicationChange, CommunicationLevel, CommunicationPatient } from '@/lib/types'
import { cn } from '@/lib/utils'

const REASON: Record<string, string> = {
  SLOW_RESPONSE: 'Slower responses', FREQUENT_CORRECTIONS: 'Frequent corrections', REPEATED_UNCERTAINTY: 'Repeated uncertainty',
  AUDIO_PREFERENCE: 'Read aloud', REPEATED_INTERACTION_FAILURE: 'Still hard to communicate',
  MISSED_RESPONSE: 'Missed response', RECOVERED: 'Answering steadily again', EXPLICIT_REQUEST: 'Chosen manually',
  PROFILE: 'From the profile',
}
const WORDING = { standard: 'standard', simple: 'simplified', binary: 'yes / no' } as const

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function rendererLine(c: CommunicationChange): string {
  const { before, after } = c.renderer
  if (c.to_mode === 'ASSISTED') return 'confirmed and unresolved information shown; someone helps the patient answer'
  const parts: string[] = []
  if (before.option_count !== after.option_count) {
    parts.push(after.option_count === 1 ? 'one yes / no question at a time'
                                        : `${before.option_count} → ${after.option_count} choices`)
  }
  if (before.button_size !== after.button_size) parts.push(`${after.button_size} buttons`)
  if (before.wording !== after.wording) parts.push(`${WORDING[after.wording]} wording`)
  if (!before.confirm_selections && after.confirm_selections) parts.push('confirms each choice')
  if (!before.audio && after.audio) parts.push('reads aloud')
  return parts.join(', ') || 'no visible change'
}

/** The trace judges ask for: what was measured, what the policy decided, what the tablet now draws. */
function Trace({ c }: { c: CommunicationChange }) {
  const s = c.signals
  return (
    <details className="rounded-2xl bg-surface p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-1 font-semibold">
        <ChevronDown className="size-4" aria-hidden="true" /> How it decided
      </summary>
      <dl className="mt-2 grid gap-3 font-mono text-xs md:grid-cols-3">
        <div>
          <dt className="mb-1 font-sans text-sm font-semibold">1 · Signal detection</dt>
          <dd>slowdown_ratio: {s.slowdown_ratio ?? '–'} ({s.baseline_source ?? 'no'} baseline, {s.baseline_status})</dd>
          <dd>slow responses: {s.slow_responses} · sustained: {String(s.sustained_slowdown)}</dd>
          <dd>corrections: {s.correction_count} · missed taps: {s.failed_input_attempts}</dd>
          <dd>uncertainty: {s.uncertainty_count} · unexpected: {s.inconsistent_count}</dd>
          <dd>missed responses: {s.missed_response_count} · fatigue: {s.fatigue_score}</dd>
        </div>
        <div>
          <dt className="mb-1 font-sans text-sm font-semibold">2 · Adaptation policy</dt>
          <dd>{c.from_mode} → {c.to_mode}</dd>
          <dd>reason: {c.reason}</dd>
          <dd>severity: LEVEL_{c.severity}</dd>
          {c.added.length > 0 && <dd>modifiers: +{c.added.join(', +')}</dd>}
        </div>
        <div>
          <dt className="mb-1 font-sans text-sm font-semibold">3 · Interface renderer</dt>
          <dd>option_count: {c.renderer.before.option_count} → {c.renderer.after.option_count}</dd>
          <dd>button_size: {c.renderer.after.button_size} · spacing: {c.renderer.after.spacing}</dd>
          <dd>wording: {c.renderer.after.wording} · confirm: {String(c.renderer.after.confirm_selections)}</dd>
          <dd>audio: {String(c.renderer.after.audio)}</dd>
        </div>
      </dl>
    </details>
  )
}

/** Adaptive communication at the nurse station: each patient's current mode, why it changed (in numbers),
 *  what changed on their screen, and this shift's history. Never a statement about cognition: it describes
 *  how hard communicating has been, not the patient. */
export function CommunicationPanel() {
  const [rows, setRows] = useState<CommunicationPatient[]>([])
  const load = useCallback(() => api.get<CommunicationPatient[]>('/api/communication').then(setRows).catch(() => {}), [])
  useEffect(() => {
    void load()
  }, [load])
  useChannel('nurse', (m) => {
    if (m.type === 'communication_changed') void load()
  })

  const setLevel = async (r: CommunicationPatient, level: CommunicationLevel) => {
    if (r.session_id) await api.post(`/api/sessions/${r.session_id}/level`, { level, by: 'nurse' })
  }

  if (rows.length === 0) return null
  return (
    <section aria-labelledby="comm-h" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 id="comm-h" className="text-xl font-bold">How patients are communicating</h2>
        <p className="text-sm text-muted-foreground">
          Tablets adapt how they ask when answering gets harder, and step back when it gets easier
        </p>
      </header>
      {rows.map((r) => {
        const c = r.last_change
        return (
          <article key={r.patient_id} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
            <header className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{r.room}</span>
              <span className="font-semibold">{r.patient_name}</span>
              {r.label && (
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                    (r.level ?? 1) >= 3 ? 'bg-urgent-soft text-urgent' : (r.level ?? 1) === 2 ? 'bg-primary-soft text-primary' : 'bg-muted')}>
                  {r.label}
                </span>
              )}
              {r.active && r.level && (
                <span className="ml-auto flex gap-1">
                  <button type="button" disabled={r.level >= 4} onClick={() => setLevel(r, (r.level! + 1) as CommunicationLevel)}
                          className="min-h-9 rounded-full border border-border px-3 text-sm font-semibold hover:border-primary/40 disabled:opacity-40">
                    Easier
                  </button>
                  <button type="button" disabled={r.level <= 1} onClick={() => setLevel(r, (r.level! - 1) as CommunicationLevel)}
                          className="min-h-9 rounded-full border border-border px-3 text-sm font-semibold hover:border-primary/40 disabled:opacity-40">
                    More choices
                  </button>
                </span>
              )}
            </header>

            {c && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted-foreground">Adapted from</dt><dd>{c.from_label} → <strong>{c.to_label}</strong> at {time(c.at)}</dd>
                <dt className="text-muted-foreground">Reason</dt><dd>{REASON[c.reason ?? ''] ?? c.reason}: {c.explanation}</dd>
                <dt className="text-muted-foreground">Screen change</dt><dd>{rendererLine(c)}</dd>
                {c.note && (<><dt className="text-muted-foreground">Summary</dt><dd className="italic">{c.note}</dd></>)}
              </dl>
            )}

            {r.summary && (
              <div className="grid gap-3 rounded-2xl border border-primary/30 bg-primary-soft p-3 text-sm sm:grid-cols-3">
                <div><p className="font-semibold">Confirmed</p>{r.summary.confirmed.map((x) => <p key={x.field}>{x.field}: {x.value}</p>)}</div>
                <div><p className="font-semibold">Unresolved</p>{r.summary.unresolved.map((x) => <p key={x.field}>{x.field}</p>)}</div>
                <div><p className="font-semibold">Current belief</p>{r.summary.belief.map((x) => <p key={x.label}>{x.label}: {Math.round(x.p * 100)}%</p>)}</div>
              </div>
            )}

            {r.changes.length > 0 && (
              <ol className="flex flex-col gap-1">
                {r.changes.slice(-5).map((h, i) => (
                  <li key={h.id ?? `${h.event}-${i}`} className="border-l-4 border-border pl-3 text-sm">
                    <span className="font-semibold">{h.from_label && h.from_label !== h.to_label ? `${h.from_label} → ` : ''}{h.to_label}</span>{' '}
                    at {time(h.at)} <span className="text-muted-foreground">({h.explanation ?? REASON[h.reason ?? ''] ?? h.reason})</span>
                  </li>
                ))}
              </ol>
            )}
            {c && <Trace c={c} />}
          </article>
        )
      })}
    </section>
  )
}
