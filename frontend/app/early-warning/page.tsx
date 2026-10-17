import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { ForecastView } from '@/components/risk/forecast-view'
import { LeadTimeline } from '@/components/risk/lead-timeline'

export const metadata = { title: 'Early warnings — SilentSignal' }

export default function EarlyWarningPage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold md:text-4xl">Early warnings</h1>
            <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
              Who might need an extra check in the next day or two, and why. Falls, dehydration and confusion,
              spotted early from changes in each patient&apos;s own patterns.
            </p>
          </header>
          <ForecastView />
          <details className="rounded-3xl border border-border bg-card p-5 md:p-6">
            <summary className="cursor-pointer text-lg font-semibold">
              Does this work? Replay how early it warned before falls in practice data
            </summary>
            <div className="mt-6">
              <LeadTimeline />
            </div>
          </details>
        </div>
      </HydrationGate>
    </AppShell>
  )
}
