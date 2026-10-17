'use client'

import { Siren } from 'lucide-react'
import { api } from '@/lib/services/backend'
import { useUrgent } from '@/lib/live/urgent'
import { cn } from '@/lib/utils'

/** `patientId`: on a patient's tablet, pressing it also alerts the nurse station (the overlay says whether
 *  that worked). Without it (staff pages) it only shows the full-screen help message. */
export function UrgentButton({
  className,
  compact = false,
  patientId,
}: {
  className?: string
  compact?: boolean
  patientId?: string
}) {
  const openUrgent = useUrgent((s) => s.openUrgent)
  const setNotice = useUrgent((s) => s.setNotice)

  const press = async () => {
    openUrgent()   // the screen first, whatever happens next
    if (!patientId) return
    setNotice({ ok: true, text: 'Telling the nurse station…' })
    try {
      await api.post(`/api/patients/${patientId}/urgent`)
      setNotice({ ok: true, text: 'The nurse station has been alerted.' })
    } catch {
      setNotice({ ok: false, text: 'Could not reach the nurse station. Show this screen to someone nearby.' })
    }
  }

  return (
    <button
      type="button"
      onClick={press}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full bg-urgent font-semibold text-urgent-foreground shadow-sm transition-colors hover:bg-urgent/90 focus-visible:outline-urgent',
        compact ? 'h-11 px-4 text-sm' : 'h-12 px-5 text-base',
        className,
      )}
    >
      <Siren className="size-5" aria-hidden="true" />
      <span>Urgent help</span>
    </button>
  )
}
