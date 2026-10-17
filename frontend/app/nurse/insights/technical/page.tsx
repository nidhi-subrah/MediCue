import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AnalyticsView } from '@/components/analytics/analytics-view'
import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'

export const metadata = { title: 'How this works — SilentSignal' }

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
        </div>
      </HydrationGate>
    </AppShell>
  )
}
