import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { LeadTimeline } from '@/components/risk/lead-timeline'

export const metadata = { title: 'Early warning — SilentSignal' }

export default function EarlyWarningPage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold md:text-4xl">Early warning, replayed</h1>
            <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
              Fourteen days of synthetic activity per resident. Each storyline drifts over 3 to 5 days before a
              labelled outcome. The engine sees only taps, chart events and fatigue, compared with the patient&apos;s
              own previous week.
            </p>
          </header>
          <LeadTimeline />
        </div>
      </HydrationGate>
    </AppShell>
  )
}
