'use client'

import {
  ArrowRight, BellRing, CircleCheck, ClipboardList, Languages, NotebookPen, Siren, Tablet, TrendingUp,
  TriangleAlert, Users,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, useChannel } from '@/lib/services/backend'
import type { Alert, CommunicationPatient, Patient, PatientTrend } from '@/lib/types'
import { LANGUAGE_NAME } from '@/lib/languages'
import { cn } from '@/lib/utils'

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('')

/** Staff landing page: one card per patient with what needs the nurse now (open requests), how they are
 *  communicating (tablet level, 7-day request trend) and what the chart flags. The bedside tablet itself
 *  is the patient's screen and is not opened from here. */
export function HomeView() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [ladder, setLadder] = useState<CommunicationPatient[]>([])
  const [trends, setTrends] = useState<PatientTrend[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadAlerts = useCallback(() => api.get<Alert[]>('/api/alerts?status=open').then(setAlerts).catch(() => {}), [])
  const loadLadder = useCallback(() => api.get<CommunicationPatient[]>('/api/communication').then(setLadder).catch(() => {}), [])

  useEffect(() => {
    api.get<Patient[]>('/api/patients').then(setPatients).catch((e) => setError(String(e)))
    api.get<PatientTrend[]>('/api/trends').then(setTrends).catch(() => {})
    void loadAlerts()
    void loadLadder()
  }, [loadAlerts, loadLadder])

  useChannel('nurse', (m) => {
    if (m.type === 'alert' || m.type === 'alert_updated') void loadAlerts()
    if (m.type === 'communication_changed') void loadLadder()
  })

  const openFor = (id: string) => alerts.filter((a) => a.patient_id === id)
  const rank = (p: Patient) => {
    const open = openFor(p.id)
    return open.some((a) => a.priority === 'urgent') ? 0 : open.length > 0 ? 1 : 2
  }
  const sorted = [...patients].sort((a, b) => rank(a) - rank(b))

  const urgentCount = alerts.filter((a) => a.priority === 'urgent').length
  const simplified = ladder.filter((r) => r.active && (r.level ?? 1) >= 2).length
  const trendFlagged = trends.filter((t) => t.flags.length > 0).length
  const chartFlags = patients.reduce((n, p) => n + Object.values(p.chart).filter((c) => c.flag).length, 0)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <span className="w-fit rounded-md border border-border px-1.5 font-mono text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
          Synthetic demo patients
        </span>
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-balance md:text-5xl">Patients</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty">
          Who needs you now, how each patient is communicating, and what their chart flags. Requests from bedside
          tablets update here live.
        </p>
      </header>

      {error && (
        <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-5 text-base text-urgent">
          Can&apos;t reach the patient directory right now. ({error})
        </p>
      )}

      {patients.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={urgentCount > 0 ? Siren : BellRing}
            tone={urgentCount > 0 ? 'urgent' : alerts.length > 0 ? 'primary' : 'calm'}
            label="Open requests"
            value={alerts.length}
            note={urgentCount > 0 ? `${urgentCount} urgent` : alerts.length > 0 ? 'none urgent' : 'all answered'}
            href={alerts.length > 0 ? '/nurse' : undefined}
          />
          <Stat icon={Tablet} tone={simplified > 0 ? 'primary' : 'calm'} label="Tablets simplified" value={simplified}
                note="answering got harder" />
          <Stat icon={TrendingUp} tone={trendFlagged > 0 ? 'caution' : 'calm'} label="Trend flags" value={trendFlagged}
                note="vs own 7-day baseline" />
          <Stat icon={ClipboardList} tone={chartFlags > 0 ? 'caution' : 'calm'} label="Chart flags" value={chartFlags}
                note={`across ${patients.length} patients`} />
        </dl>
      )}

      <ul className="grid gap-4 lg:grid-cols-2">
        {sorted.map((p, i) => (
          <motion.li
            key={p.id}
            layout
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <PatientCard
              patient={p}
              open={openFor(p.id)}
              level={ladder.find((r) => r.patient_id === p.id) ?? null}
              trend={trends.find((t) => t.patient_id === p.id) ?? null}
            />
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

type Tone = 'urgent' | 'primary' | 'caution' | 'calm'

const TONE: Record<Tone, string> = {
  urgent: 'bg-urgent text-urgent-foreground',
  primary: 'bg-primary text-primary-foreground',
  caution: 'bg-caution-soft text-caution',
  calm: 'bg-muted text-muted-foreground',
}

function Stat({ icon: Icon, tone, label, value, note, href }: {
  icon: typeof Siren; tone: Tone; label: string; value: number; note: string; href?: string
}) {
  const body = (
    <>
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl', TONE[tone])}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
        <dd className="flex flex-col">
          <span className="text-3xl font-bold leading-tight tabular-nums">{value}</span>
          <span className={cn('text-sm', tone === 'urgent' ? 'font-semibold text-urgent' : 'text-muted-foreground')}>{note}</span>
        </dd>
      </div>
    </>
  )
  const cls = 'flex items-center gap-3 rounded-3xl border-2 border-border bg-card p-4'
  return href ? (
    <Link href={href} className={cn(cls, 'hover:border-primary/40')}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function PatientCard({ patient: p, open, level, trend }: {
  patient: Patient; open: Alert[]; level: CommunicationPatient | null; trend: PatientTrend | null
}) {
  const urgent = open.some((a) => a.priority === 'urgent')
  const flags = Object.values(p.chart).filter((c) => c.flag)
  const latest = open[0]
  const requests = trend?.series.needs ?? []
  const topFlag = trend?.flags.find((f) => f.severity === 'attention') ?? trend?.flags[0]

  return (
    <article
      aria-label={`${p.name}, room ${p.room}`}
      className={cn(
        'flex h-full flex-col gap-5 rounded-3xl border-2 bg-card p-6',
        urgent ? 'border-urgent' : open.length > 0 ? 'border-primary/50' : 'border-border',
      )}
    >
      <header className="flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-lg font-bold text-primary" aria-hidden="true">
          {initials(p.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-2xl font-bold">{p.name}</h2>
            <span className="text-base text-muted-foreground">{p.age}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="rounded-md bg-muted px-1.5 font-mono font-medium text-foreground">{p.room}</span>
            <span className="inline-flex items-center gap-1">
              <Languages className="size-3.5" aria-hidden="true" />
              {LANGUAGE_NAME[p.language] ?? p.language}
            </span>
            {p.days_since_surgery != null && <span>Post-op day {p.days_since_surgery}</span>}
          </div>
        </div>
        <StatusPill open={open.length} urgent={urgent} />
      </header>

      <p className="text-base leading-relaxed text-muted-foreground">{p.diagnosis}</p>

      {latest && (
        <Link
          href="/nurse"
          className={cn(
            'flex items-center gap-3 rounded-2xl border px-4 py-3 hover:border-primary/40',
            urgent ? 'border-urgent/40 bg-urgent-soft' : 'border-primary/30 bg-primary-soft',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={cn('text-xs font-semibold uppercase tracking-wide', urgent ? 'text-urgent' : 'text-primary')}>
              {latest.priority === 'urgent' ? 'Urgent request' : 'Open request'}
            </span>
            <span className="font-semibold">{latest.label ?? latest.top[0]?.label ?? 'Request from the tablet'}</span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold">
            Nurse station <ArrowRight className="size-4" aria-hidden="true" />
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-2xl bg-surface p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tablet</span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Tablet className="size-4 text-muted-foreground" aria-hidden="true" />
            {level?.active && level.label ? level.label : 'Not in use now'}
          </span>
          {level && level.changes.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {level.changes.length} change{level.changes.length === 1 ? '' : 's'} this shift
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded-2xl bg-surface p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requests per day</span>
          {requests.length > 1 ? (
            <div className="flex items-end gap-2">
              <span className="text-xl font-bold tabular-nums">{Math.round(requests[requests.length - 1] ?? 0)}</span>
              <Sparkline values={requests} label={`Requests per day over 7 days, ending at ${Math.round(requests[requests.length - 1] ?? 0)} in the last 24 hours`} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No history yet</span>
          )}
          <span className="text-xs text-muted-foreground">last 24 h, 7-day trend</span>
        </div>
      </div>

      {topFlag && (
        <p className={cn(
          'border-l-4 pl-3 text-sm leading-relaxed',
          topFlag.severity === 'attention' ? 'border-urgent' : 'border-caution',
        )}>
          <span className={cn('font-semibold', topFlag.severity === 'attention' ? 'text-urgent' : 'text-caution')}>
            {topFlag.severity === 'attention' ? 'Needs attention' : 'Review'}
          </span>{' '}
          {topFlag.message.split('. Recent chart event')[0]}
        </p>
      )}

      {flags.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chart flags</span>
          <ul className="flex flex-wrap gap-2">
            {flags.map((f) => (
              <li key={f.value} className="inline-flex items-center gap-1.5 rounded-full bg-caution-soft px-3 py-1 text-sm font-medium text-foreground">
                <TriangleAlert className="size-3.5 text-caution" aria-hidden="true" />
                {f.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Link
          href={`/profile/${p.id}`}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <NotebookPen className="size-4" aria-hidden="true" />
          Notes and profile
        </Link>
        {p.people.map((person) => (
          <Link
            key={person.id}
            href={`/family/${person.id}`}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:border-primary/40"
          >
            <Users className="size-4" aria-hidden="true" />
            {person.name.split(' ')[0]}, {person.relation}
          </Link>
        ))}
      </footer>
    </article>
  )
}

function StatusPill({ open, urgent }: { open: number; urgent: boolean }) {
  if (urgent) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-urgent px-3 py-1 text-sm font-semibold text-urgent-foreground">
        <Siren className="size-4" aria-hidden="true" /> Urgent
      </span>
    )
  }
  if (open > 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
        <BellRing className="size-4" aria-hidden="true" /> {open} open
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success">
      <CircleCheck className="size-4" aria-hidden="true" /> Settled
    </span>
  )
}

/** 7 daily values + the last 24 h; the last point is marked. Quiet line, no axes: the number beside it is the reading. */
function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const v = values.map((x) => x ?? 0)
  const max = Math.max(1, ...v)
  const W = 96, H = 28
  const pts = v.map((x, i) => [(i / (v.length - 1)) * (W - 4) + 2, H - 3 - (x / max) * (H - 6)] as const)
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="text-primary">
      <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
      {last && <circle cx={last[0]} cy={last[1]} r="3" fill="currentColor" />}
    </svg>
  )
}
