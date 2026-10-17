'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useUnitInsights } from '@/lib/live/nurse-views'
import type { UnitInsights } from '@/lib/types'
import { Toggle } from './common'
import { InsightsGauges } from './insights-gauges'
import { InsightsHeatmap } from './insights-heatmap'
import { InsightsNeeds } from './insights-needs'
import { InsightsTimeline } from './insights-timeline'

/** Unit insights: what HAS happened. Past only, no predictions (those live in Care forecast). */
export function InsightsView() {
  const [range, setRange] = useState<UnitInsights['range']>('24h')
  const [hours, setHours] = useState(12)
  const { data, error } = useUnitInsights(range, hours)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/nurse" className="inline-flex items-center gap-2 self-start text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Nurse station
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold md:text-4xl">Unit insights</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            What has happened on the unit. For what&apos;s likely next, see{' '}
            <Link href="/nurse/forecast" className="font-semibold text-primary hover:underline">Care forecast</Link>.
          </p>
        </div>
        <Toggle label="Time period" value={range} onChange={setRange}
                options={[{ value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }, { value: '14d', label: '14 days' }]} />
      </header>

      {error && <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-6 text-base text-urgent">{error}</p>}
      {!data && !error && <p className="text-lg text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <InsightsGauges data={data} />
          <InsightsHeatmap data={data} />
          <InsightsTimeline data={data} hours={hours} onHours={setHours} />
          <InsightsNeeds data={data} />
        </>
      )}

      <p className="text-sm text-muted-foreground">
        All patient data here is synthetic.{' '}
        <Link href="/nurse/insights/technical" className="underline underline-offset-4 hover:text-foreground">How this works</Link>
      </p>
    </div>
  )
}
