'use client'

import { useState } from 'react'
import type { Patient, StaffMember } from '@/lib/types'

export function ObservationForm({
  staff,
  patients,
  onSubmit,
}: {
  staff: StaffMember[]
  patients: Patient[]
  onSubmit: (text: string, clinicianId: string, patientId: string | null) => Promise<{ statement: string; test: unknown | null }>
}) {
  const [clinician, setClinician] = useState('')
  const [patient, setPatient] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clinician || !text.trim()) return
    setBusy(true)
    setStatus(null)
    try {
      const h = await onSubmit(text, clinician, patient || null)
      setText('')
      setStatus({
        ok: true,
        msg:
          `Observation added as a hypothesis for investigation: "${h.statement}"` +
          (h.test ? '' : " It couldn't be turned into a data test yet, so the agent will ask clinicians."),
      })
    } catch (err) {
      setStatus({ ok: false, msg: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Add an observation</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Your words are kept as written. It becomes a hypothesis to investigate, not a finding.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        <span>Clinician</span>
        <select
          required
          value={clinician}
          onChange={(e) => setClinician(e.target.value)}
          className="min-h-11 rounded-xl border border-input bg-background px-3 text-base font-normal"
        >
          <option value="">Choose…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        <span>Patient (optional)</span>
        <select
          value={patient}
          onChange={(e) => setPatient(e.target.value)}
          className="min-h-11 rounded-xl border border-input bg-background px-3 text-base font-normal"
        >
          <option value="">Detect from text</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.room}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        <span>Observation</span>
        <textarea
          required
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Mr. Chen seems more anxious after his daughter leaves."
          className="resize-none rounded-xl border border-input bg-background p-3 text-base font-normal leading-relaxed"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !clinician || !text.trim()}
        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add observation'}
      </button>
      {status && (
        <p role="status" className={status.ok ? 'text-sm text-success' : 'text-sm text-urgent'}>
          {status.msg}
        </p>
      )}
    </form>
  )
}
