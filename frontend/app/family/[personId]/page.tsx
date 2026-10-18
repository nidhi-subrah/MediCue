import { Brand } from '@/components/app/brand'
import { FamilyView } from '@/components/family/family-view'

export const metadata = { title: 'Helper view — MediCue' }

export default async function FamilyPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params
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
        <div className="absolute -top-32 right-[15%] size-[400px] rounded-full bg-[oklch(0.94_0.03_262_/_0.2)] blur-[80px]" />
        <div className="absolute -bottom-24 left-[10%] size-[350px] rounded-full bg-[oklch(0.94_0.02_280_/_0.15)] blur-[60px]" />
      </div>
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-6 px-3 py-6 md:px-6 md:py-10">
        <header className="flex items-center justify-between">
          <Brand />
          <p className="patient-chip text-xs text-muted-foreground">Prototype · synthetic data</p>
        </header>
        <FamilyView personId={personId} />
      </div>
    </div>
  )
}
