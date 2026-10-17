import { Brand } from '@/components/app/brand'
import { FamilyView } from '@/components/family/family-view'

export const metadata = { title: 'Helper view — MediCue' }

/** A minimal shell, not the staff AppShell: this is opened by a family member on their own
 *  device, the same way the old frontend hid the nurse/research nav for the family page. */
export default async function FamilyPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <Brand href="/home" />
        <p className="text-xs text-muted-foreground">Prototype with synthetic data. Not a diagnostic device.</p>
      </header>
      <FamilyView personId={personId} />
    </div>
  )
}
