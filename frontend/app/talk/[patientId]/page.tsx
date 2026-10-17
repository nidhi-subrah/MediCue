import { HydrationGate } from '@/components/app/hydration-gate'
import { TalkView } from '@/components/talk/talk-view'
import { LiveSessionProvider } from '@/lib/live/session'

export const metadata = { title: 'Bedside tablet — SilentSignal' }

/** No AppShell here on purpose: the bedside tablet stays distraction-free, the same way
 *  the old frontend hid the top nav for the patient-facing view. */
export default async function TalkPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <LiveSessionProvider patientId={patientId}>
        <HydrationGate>
          <TalkView />
        </HydrationGate>
      </LiveSessionProvider>
    </div>
  )
}
