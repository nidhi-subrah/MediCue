import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { NurseView } from '@/components/nurse/nurse-view'

export const metadata = { title: 'Nurse station — MediCue' }

export default function NursePage() {
  return (
    <AppShell wide>
      <HydrationGate>
        <NurseView />
      </HydrationGate>
    </AppShell>
  )
}
