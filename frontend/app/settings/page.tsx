import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { SettingsView } from '@/components/settings/settings-view'

export const metadata = { title: 'Accessibility settings — SilentSignal' }

export default function SettingsPage() {
  return (
    <AppShell>
      <HydrationGate>
        <SettingsView />
      </HydrationGate>
    </AppShell>
  )
}
