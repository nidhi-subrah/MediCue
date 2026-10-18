import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { ResearchView } from '@/components/research/research-view'

export const metadata = { title: 'Research Agent — MediCue' }

export default function ResearchPage() {
  return (
    <AppShell>
      <HydrationGate>
        <ResearchView />
      </HydrationGate>
    </AppShell>
  )
}
