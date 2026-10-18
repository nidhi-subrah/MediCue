'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { Patient, StaffMember } from '@/lib/types'

/** "+ Add observation": a clinician's own observation becomes a hypothesis to investigate (never a finding). */
export function ObservationButton({
  staff,
  patients,
  onSubmit,
  onAdded,
}: {
  staff: StaffMember[]
  patients: Patient[]
  onSubmit: (text: string, clinicianId: string, patientId: string | null) => Promise<{ statement: string; test: unknown | null }>
  onAdded: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [clinician, setClinician] = useState('')
  const [patient, setPatient] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !clinician || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const h = await onSubmit(text.trim(), clinician, patient || null)
      setText('')
      setOpen(false)
      onAdded(`Observation added for investigation: “${h.statement}”` +
              (h.test ? '' : ' It can’t be turned into a data test, so the agent will ask clinicians.'))
    } catch (err) {
      setError(`Couldn't add the observation. ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-semibold hover:bg-muted">
        <Plus className="size-4" aria-hidden="true" /> Add observation
      </button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="text-xl font-bold">Add an observation</DialogTitle>
          <DialogDescription>
            Your words are kept as written. The agent turns them into a hypothesis to investigate, not a finding.
          </DialogDescription>
          <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              <span>Clinician</span>
              <select required value={clinician} onChange={(e) => setClinician(e.target.value)}
                      className="min-h-11 rounded-xl border border-input bg-background px-3 text-base font-normal">
                <option value="">Choose…</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              <span>Patient (optional)</span>
              <select value={patient} onChange={(e) => setPatient(e.target.value)}
                      className="min-h-11 rounded-xl border border-input bg-background px-3 text-base font-normal">
                <option value="">Detect from the text</option>
                {patients.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.room}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              <span>Observation</span>
              <textarea required rows={4} value={text} onChange={(e) => setText(e.target.value)}
                        placeholder="e.g. Mr. Chen seems more anxious after his daughter leaves."
                        className="resize-none rounded-xl border border-input bg-background p-3 text-base font-normal leading-relaxed" />
            </label>
            {error && <p role="alert" className="text-sm text-urgent">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy}
                      className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted">
                Cancel
              </button>
              <button type="submit" disabled={busy || !clinician || !text.trim()}
                      className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                {busy ? 'Adding…' : 'Add observation'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
