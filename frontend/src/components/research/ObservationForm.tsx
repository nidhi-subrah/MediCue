import { useState } from "react";
import type { Patient, ResearchHypothesis, StaffMember } from "@shared/types";
import { api } from "../../api";

export default function ObservationForm({ staff, patients }: { staff: StaffMember[]; patients: Patient[] }) {
  const [clinician, setClinician] = useState("");
  const [patient, setPatient] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinician || !text.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const h = await api.post<ResearchHypothesis>("/api/research/observations",
        { text, clinician_id: clinician, patient_id: patient || null });
      setText("");
      setStatus({ ok: true, msg: `Observation added as a hypothesis for investigation: “${h.statement}”` +
        (h.test ? "" : " (No data test could be built from it yet; the agent will ask clinicians.)") });
    } catch (err) {
      setStatus({ ok: false, msg: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card observation-form" onSubmit={submit}>
      <h3>Add a clinician observation</h3>
      <p className="muted small">Your words are kept as written. It becomes a hypothesis to investigate, not a finding.</p>
      <label>
        <span className="small">Clinician</span>
        <select required value={clinician} onChange={(e) => setClinician(e.target.value)}>
          <option value="">Choose…</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>
      </label>
      <label>
        <span className="small">Patient (optional)</span>
        <select value={patient} onChange={(e) => setPatient(e.target.value)}>
          <option value="">Detect from text / unit-wide</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.room}</option>)}
        </select>
      </label>
      <label>
        <span className="small">Observation</span>
        <textarea required rows={3} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. Mr. Chen seems more anxious after his daughter leaves." />
      </label>
      <button className="btn primary" disabled={busy || !clinician || !text.trim()}>{busy ? "Adding…" : "Add observation"}</button>
      {status && <p className={`small ${status.ok ? "ok" : "error"}`} role="status">{status.msg}</p>}
    </form>
  );
}
