'use client'

import { Siren } from 'lucide-react'
import { api } from '@/lib/services/backend'
import { useUrgent } from '@/lib/live/urgent'
import { cn } from '@/lib/utils'

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
    openUrgent()
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
        'inline-flex items-center justify-center gap-2 rounded-lg bg-urgent font-semibold text-urgent-foreground shadow-md shadow-urgent/20 transition-all hover:bg-urgent/90 hover:shadow-lg hover:shadow-urgent/25 focus-visible:outline-urgent active:scale-[0.97]',
        compact ? 'min-h-11 px-4 py-1.5 text-sm' : 'min-h-12 px-5 py-2 text-base',
        className,
      )}
    >
      <Siren className="size-5" aria-hidden="true" />
      <span>Urgent help</span>
    </button>
  )
}
