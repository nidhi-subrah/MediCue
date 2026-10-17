import { AnalyticsView } from '@/components/analytics/analytics-view'
import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'

export const metadata = { title: 'Tiger Data intelligence — SilentSignal' }

export default function AnalyticsPage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <AnalyticsView />
      </HydrationGate>
    </AppShell>
  )
}
