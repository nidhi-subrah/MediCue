'use client'

import { ArrowLeft, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useCareForecast } from '@/lib/live/nurse-views'
import { Notice } from './common'
import { ForecastFlags, ForecastRisks } from './forecast-risk'
import { ForecastBusyHours, ForecastCheck, ForecastWhy } from './forecast-unit'

const SOURCE = {
  gemini: 'Adjusted by Gemini for today’s chart and notes',
  pending: 'Updating with Gemini…',
  base: 'Based on past patterns only',
} as const

/** Care forecast: what is LIKELY to happen next. Planning only, it never changes or delays an alert. */
export function ForecastView() {
  const { data, error } = useCareForecast()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/nurse" className="inline-flex items-center gap-2 self-start text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Nurse station
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold md:text-4xl">Care forecast</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            What is likely to happen next. For what already happened, see{' '}
            <Link href="/nurse/insights" className="font-semibold text-primary hover:underline">Unit insights</Link>.
          </p>
        </div>
        {data && (
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-sm font-semibold text-primary">
            <Sparkles className="size-4" aria-hidden="true" /> {SOURCE[data.source]}
          </span>
        )}
      </header>
      <Notice>Forecasts are estimates for planning, not diagnoses. Urgent signals always alert immediately.</Notice>

      {error && <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-6 text-base text-urgent">{error}</p>}
      {!data && !error && <p className="text-lg text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <ForecastWhy f={data} />
          <ForecastRisks f={data} />
          <ForecastBusyHours f={data} />
          <ForecastFlags f={data} />
          <ForecastCheck f={data} />
        </>
      )}

      <p className="text-sm text-muted-foreground">
        All patient data here is synthetic.{' '}
        <Link href="/nurse/insights/technical" className="underline underline-offset-4 hover:text-foreground">How this works</Link>
      </p>
    </div>
  )
}
