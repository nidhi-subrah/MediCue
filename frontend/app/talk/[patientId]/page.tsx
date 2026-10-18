import { HydrationGate } from '@/components/app/hydration-gate'
import { TalkView } from '@/components/talk/talk-view'
import { LiveSessionProvider } from '@/lib/live/session'

export const metadata = { title: 'Bedside tablet — MediCue' }

/** No AppShell here on purpose: the bedside tablet stays distraction-free, the same way
 *  the old frontend hid the top nav for the patient-facing view. */
export default async function TalkPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params
  return (
    <div
      className="patient-ambient relative min-h-dvh overflow-hidden"
      style={{
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1.5rem))',
      }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 right-[10%] size-[500px] rounded-full bg-[oklch(0.94_0.03_262_/_0.25)] blur-[100px]" />
        <div className="absolute -bottom-32 left-[15%] size-[400px] rounded-full bg-[oklch(0.94_0.025_280_/_0.18)] blur-[80px]" />
      </div>
      <div className="relative mx-auto w-full max-w-6xl px-3 py-4 md:px-6 md:py-6">
        <LiveSessionProvider patientId={patientId}>
          <HydrationGate>
            <TalkView />
          </HydrationGate>
        </LiveSessionProvider>
      </div>
    </div>
  )
}
