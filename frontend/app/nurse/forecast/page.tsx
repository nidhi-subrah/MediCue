import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { ForecastView } from '@/components/nurse-views/forecast-view'

export const metadata = { title: 'Care forecast — SilentSignal' }

export default function CareForecastPage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <ForecastView />
      </HydrationGate>
    </AppShell>
  )
}
