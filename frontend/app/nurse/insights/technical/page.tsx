import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AnalyticsView } from '@/components/analytics/analytics-view'
import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { LeadTimeline } from '@/components/risk/lead-timeline'

export const metadata = { title: 'How this works — MediCue' }

/** The Tiger Data internals behind Unit insights and Care forecast (formerly /analytics). */
export default function HowThisWorksPage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <div className="flex flex-col gap-6">
          <Link href="/nurse/insights" className="inline-flex items-center gap-2 self-start text-sm font-semibold text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Unit insights
          </Link>
          <AnalyticsView />
          <section aria-labelledby="lead-title" className="flex flex-col gap-3 border-t border-border pt-8">
            <h2 id="lead-title" className="text-2xl font-bold">Early warning, replayed</h2>
            <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
              Fourteen days of synthetic activity per resident. Each storyline drifts over 3 to 5 days before a
              labelled outcome. The engine sees only taps, chart events and fatigue, compared with the patient&apos;s
              own previous week.
            </p>
            <LeadTimeline />
          </section>
        </div>
      </HydrationGate>
    </AppShell>
  )
}
