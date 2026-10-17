'use client'

import { useState } from 'react'
import { Sparkline } from '@/components/nurse/sparkline'
import { useTigerDataOverview } from '@/lib/live/analytics'
import { DecisionTrace } from './decision-trace'
import { StatCard } from './stat-card'

export function AnalyticsView() {
  const [patientId, setPatientId] = useState<string | null>(null)
  const { overview, patients, error } = useTigerDataOverview(patientId)

  if (error) {
    return <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-6 text-base text-urgent">{error}</p>
  }
  if (!overview) {
    return <p className="text-lg text-muted-foreground">Loading…</p>
  }

  const responseValues =
    overview.patient?.response_trends
      .slice()
      .sort((a, b) => b.days_ago - a.days_ago)
      .map((r) => r.avg_tap_interval) ?? []

  const needsByDate = new Map<string, number>()
  for (const r of overview.patient?.confirmed_need_trends ?? []) {
    needsByDate.set(r.date, (needsByDate.get(r.date) ?? 0) + r.count)
  }
  const needsValues = Array.from(needsByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, n]) => n)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight">Tiger Data intelligence</h1>
        <p className="text-lg text-muted-foreground">
          Every number below comes from a real query against Tiger Data — no mocked analytics.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Interaction events" value={overview.counts.events.toLocaleString()} />
        <StatCard label="Confirmed needs" value={overview.counts.confirmations.toLocaleString()} />
        <StatCard label="Belief snapshots" value={overview.counts.belief_snapshots.toLocaleString()} />
        <StatCard label="Decision candidates" value={overview.counts.decision_candidates.toLocaleString()} />
        <StatCard
          label="Hypertables"
          value={overview.hypertable_count ? String(overview.hypertable_count) : 'unavailable'}
          hint={overview.chunk_count != null ? `${overview.chunk_count} chunks` : undefined}
        />
        <StatCard label="Query latency" value={`${overview.query_latency_ms} ms`} hint="measured just now" />
        <StatCard
          label="Latest event"
          value={overview.latest_event_time ? new Date(overview.latest_event_time).toLocaleTimeString() : '—'}
        />
        <StatCard
          label="Compressed tables"
          value={`${overview.compression.filter((c) => c.available).length}/${overview.compression.length}`}
          hint="chunks ≥3 days old"
        />
      </section>

      {overview.compression.some((c) => c.available) && (
        <section className="rounded-3xl border border-border bg-card p-6">
          <h2 className="mb-3 text-lg font-bold">Compression</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {overview.compression.map((c) => (
              <div key={c.table} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{c.table}</span>
                <span className="font-mono text-sm">
                  {c.available ? `${c.compression_ratio ?? '—'}×` : 'unavailable'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Patient trends</h2>
          <select
            value={patientId ?? ''}
            onChange={(e) => setPatientId(e.target.value || null)}
            className="h-10 rounded-xl border-2 border-input bg-background px-3 text-sm"
          >
            <option value="">Choose a patient…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.room}</option>
            ))}
          </select>
        </div>

        {!overview.patient ? (
          <p className="text-sm text-muted-foreground">Choose a patient to see their response-time and needs trends.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6">
              <Sparkline values={responseValues} label="Seconds per tap (8 days)" format={(v) => `${v.toFixed(1)}s`} flagged={false} />
              <Sparkline values={needsValues} label="Confirmed needs per day" format={(v) => v.toFixed(0)} flagged={false} />
            </div>
            <p className="text-sm text-muted-foreground">
              {overview.patient.speech_interaction_trends.supported
                ? ''
                : `Speech interaction trends: ${overview.patient.speech_interaction_trends.reason}`}
            </p>
            {overview.patient.last_activity && (
              <p className="text-sm text-muted-foreground">
                Last activity: {overview.patient.last_activity.kind} at{' '}
                {new Date(overview.patient.last_activity.time).toLocaleString()}
              </p>
            )}
          </>
        )}
      </section>

      {overview.patient && <DecisionTrace patient={overview.patient} />}
    </div>
  )
}
