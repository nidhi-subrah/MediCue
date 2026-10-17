import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { HomeView } from '@/components/home/home-view'

export const metadata = { title: 'Patients — MediCue' }

export default function HomePage() {
  return (
    <AppShell>
      <HydrationGate>
        <HomeView />
      </HydrationGate>
    </AppShell>
  )
}
