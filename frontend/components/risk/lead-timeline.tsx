'use client'

import { useMemo } from 'react'
import { useLeadTimeline } from '@/lib/live/risk'
import { pct } from '@/lib/services/backend'
import type { Timeline } from '@/lib/types'
import { LevelBadge, SyntheticTag } from './level'

const W = 880 // drawing units; the SVG scales to its container
const LEFT = 8
const RIGHT = 120
const MARKS = 64 // marker labels above the tracks
const SCORE_H = 110
const SIG_H = 58
const AXIS_H = 28
const Z_MIN = -2
const Z_MAX = 4

const SPLIT = { train: 'training', test: 'held-out' } as const
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** Signals drifting, the moment the flag fired and the outcome, for one synthetic storyline. */
function Chart({ t }: { t: Timeline }) {
  const t0 = new Date(t.series[0].time).getTime()
  const t1 = new Date(t.outcome.time).getTime() + 3 * 3600e3
  const x = (iso: string | number) => LEFT + (((typeof iso === 'number' ? iso : new Date(iso).getTime()) - t0) / (t1 - t0)) * (W - LEFT - RIGHT)
  const H = MARKS + SCORE_H + t.signals.length * SIG_H + AXIS_H
  const ys = (v: number) => MARKS + 10 + (1 - v) * (SCORE_H - 24)
  const sigTop = (i: number) => MARKS + SCORE_H + i * SIG_H
  const yz = (i: number, z: number) => sigTop(i) + 18 + (1 - (Math.min(Math.max(z, Z_MIN), Z_MAX) - Z_MIN) / (Z_MAX - Z_MIN)) * (SIG_H - 26)
  const bottom = H - AXIS_H

  const line = (pts: [number, number | null][]) =>
    pts.reduce((acc, [px, py], i) => {
      if (py === null) return acc
      const join = acc !== '' && pts[i - 1]?.[1] != null
      return acc + `${join ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`
    }, '')

  const ticks = useMemo(() => {
    const out: number[] = []
    const d = new Date(t0)
    d.setHours(0, 0, 0, 0)
    for (d.setDate(d.getDate() + 1); d.getTime() < t1; d.setDate(d.getDate() + 1)) out.push(d.getTime())
    return out
  }, [t0, t1])

  const xOnset = x(t.outcome.onset)
  const xOut = x(t.outcome.time)
  const xFlag = t.flag ? x(t.flag.time) : null
  const outcomeLabel = t.headline.replace(/^.*synthetic /, 'Synthetic ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="block min-w-[640px] text-[12px]"
         aria-label={`${t.headline}. Risk score and the signals behind it over the week before the event.`}>
      {xOnset > LEFT && (
        <g>
          <line x1={xOnset} x2={xOnset} y1={46} y2={bottom} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="2 4" />
          <text x={xOnset + 4} y={58} className="fill-muted-foreground">Storyline begins (synthetic label)</text>
        </g>
      )}
      {xFlag !== null && t.flag && (
        <g className="fill-primary stroke-primary">
          <line x1={xFlag} x2={xFlag} y1={28} y2={bottom} strokeWidth={1.5} />
          <text x={xFlag + 4} y={40} stroke="none" fontWeight={600}>
            {t.flag.level === 'elevated' ? 'Elevated' : 'Watch'} flag fired · {when(t.flag.time)}
          </text>
          <line x1={xFlag} x2={xOut} y1={bottom - 6} y2={bottom - 6} strokeWidth={2} />
          <text x={(xFlag + xOut) / 2} y={bottom - 11} textAnchor="middle" stroke="none" fontWeight={600} className="font-mono">
            {t.lead_days?.toFixed(1)} days
          </text>
        </g>
      )}
      <g className="fill-urgent stroke-urgent">
        <line x1={xOut} x2={xOut} y1={10} y2={bottom} strokeWidth={2} />
        <text x={xOut - 4} y={22} textAnchor="end" stroke="none" fontWeight={600}>{outcomeLabel}</text>
      </g>

      <text x={LEFT} y={MARKS + 4} className="fill-foreground" fontWeight={600}>{t.label} score</text>
      {(['watch', 'elevated'] as const).map((k) => (
        <g key={k}>
          <line x1={LEFT} x2={W - RIGHT} y1={ys(t.thresholds[k])} y2={ys(t.thresholds[k])} className="stroke-border" strokeDasharray="3 4" />
          <text x={W - RIGHT + 6} y={ys(t.thresholds[k]) + 4} className="fill-muted-foreground text-[11px]">
            {k === 'watch' ? 'Watch' : 'Elevated'} {pct(t.thresholds[k])}
          </text>
        </g>
      ))}
      <path d={line(t.series.map((p) => [x(p.time), ys(p.score)]))} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" />

      {t.signals.map((s, i) => (
        <g key={s.key}>
          <line x1={LEFT} x2={W - RIGHT} y1={sigTop(i)} y2={sigTop(i)} className="stroke-border" />
          <text x={LEFT} y={sigTop(i) + 14} className="fill-foreground" fontWeight={600}>
            {s.label} · SD from usual, toward risk ({s.risky})
          </text>
          <line x1={LEFT} x2={W - RIGHT} y1={yz(i, 0)} y2={yz(i, 0)} className="stroke-border" strokeDasharray="3 4" />
          <text x={W - RIGHT + 6} y={yz(i, 0) + 4} className="fill-muted-foreground text-[11px]">usual</text>
          <text x={W - RIGHT + 6} y={yz(i, 3) + 4} className="fill-muted-foreground text-[11px]">+3 SD</text>
          <path d={line(t.series.map((p) => [x(p.time), p.z[s.key] == null ? null : yz(i, p.z[s.key] as number)]))}
                fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      ))}

      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={x(tick)} x2={x(tick)} y1={bottom} y2={bottom + 5} className="stroke-border" />
          <text x={x(tick) + 3} y={bottom + 18} className="fill-muted-foreground text-[11px]">{day(tick)}</text>
        </g>
      ))}
    </svg>
  )
}

export function LeadTimeline() {
  const { cases, patientId, setPatientId, timeline: t, error } = useLeadTimeline()
  const atFlag = t?.flag ? t.series.find((p) => p.time === t.flag?.time) : undefined
  const drift = atFlag && t
    ? t.signals.filter((s) => (atFlag.z[s.key] ?? 0) >= 1)
        .map((s) => `${s.label.toLowerCase()} ${(atFlag.z[s.key] as number).toFixed(1)} SD toward risk`)
    : []

  return (
    <section aria-labelledby="lead-h" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <h2 id="lead-h" className="text-xl font-bold">Lead time</h2>
        <label className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span className="sr-only">Storyline</span>
          <select value={patientId ?? ''} onChange={(e) => setPatientId(e.target.value)}
                  className="min-h-11 max-w-full rounded-xl border border-input bg-card px-3 text-base text-foreground">
            {cases.map((c) => (
              <option key={c.patient_id} value={c.patient_id}>
                {c.name} · {c.label} · {SPLIT[c.split]} · {c.lead_days === null ? 'no flag' : `${c.lead_days.toFixed(1)} d`}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && <p className="text-sm text-urgent">{error}</p>}
      {t && (
        <>
          <p className="text-2xl font-bold tracking-tight md:text-3xl">{t.headline}</p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <SyntheticTag /> {t.name} ({t.room}) · {t.label}
            {t.flag && <> · first flag <LevelBadge level={t.flag.level} /></>} · {SPLIT[t.split]} patient
          </p>
          {t.series.length > 1 ? (
            <div className="overflow-x-auto rounded-3xl border border-border bg-card p-4"><Chart t={t} /></div>
          ) : (
            <p className="text-muted-foreground">No scores for this week.</p>
          )}
          {drift.length > 0 && <p>When the flag fired: {drift.join('; ')}.</p>}
          <p className="text-xs text-muted-foreground">
            All data is synthetic. Lead time runs from the first flag on this patient&apos;s own risk after the
            storyline began to the labelled outcome; the engine never sees the label.
            {t.flags_before_onset > 0 && ` ${t.flags_before_onset} earlier flag(s) before the storyline began are not counted.`}
            {' '}Flags are prompts for clinician review, not diagnoses.
          </p>
        </>
      )}
    </section>
  )
}
