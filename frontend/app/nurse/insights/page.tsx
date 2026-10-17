import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { InsightsView } from '@/components/nurse-views/insights-view'

export const metadata = { title: 'Unit insights — SilentSignal' }

export default function UnitInsightsPage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <InsightsView />
      </HydrationGate>
    </AppShell>
  )
}
