import { AppShell } from '@/components/app/app-shell'
import { HydrationGate } from '@/components/app/hydration-gate'
import { ProfileView } from '@/components/profile/profile-view'

export const metadata = { title: 'Notes and profile — SilentSignal' }

export default async function ProfilePage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  return (
    <AppShell wide>
      <HydrationGate>
        <ProfileView patientId={patientId} />
      </HydrationGate>
    </AppShell>
  )
}
