import { useEffect, useState } from "react";
import type { Patient, PatientProfile } from "@shared/types";
import { api, timeAgo, useChannel } from "../api";
import ProfileList from "../components/ProfileList";

/** A patient's chart notes and the profile Gemini read from them, with the quote behind every item. */
export default function ProfilePage({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Patient>(`/api/patients/${patientId}`).then(setPatient).catch((e) => setError(String(e)));
    api.get<PatientProfile>(`/api/patients/${patientId}/profile`).then((p) => { setProfile(p); setNotes(p.notes); });
  }, [patientId]);

  useChannel("nurse", (m) => {
    if (m.type === "profile" && m.profile.patient_id === patientId) setProfile(m.profile);
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setProfile(await api.post<PatientProfile>(`/api/patients/${patientId}/notes`, { notes }));
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error && !patient) return <p className="error">{error}</p>;
  if (!patient || !profile) return <p className="empty">Loading…</p>;
  const changed = notes.trim() !== profile.notes.trim();
  const reading = saving || profile.extracting;

  return (
    <div className="profile-page">
      <header className="section-head">
        <div>
          <h1>{patient.name}</h1>
          <p className="section-meta"><span className="alert-room">{patient.room}</span> · {patient.diagnosis}</p>
        </div>
        <a href={`#/patient/${patient.id}`}>Open bedside tablet</a>
      </header>

      <div className="profile-grid">
        <section>
          <h2>Chart notes</h2>
          <textarea className="notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={6}
                    aria-label="Chart notes" />
          <div className="confirm-row">
            <button className="btn btn-primary" onClick={save} disabled={!changed || reading || !notes.trim()}>
              {reading ? "Reading notes…" : "Save and re-read"}
            </button>
            {changed && !reading && <button className="btn btn-quiet" onClick={() => setNotes(profile.notes)}>Undo</button>}
          </div>
          {error && <p className="error">{error}</p>}
          <p className="fineprint">
            Gemini reads these notes into the profile on the right. Every item must quote the notes word for word,
            effects are capped, and high-risk needs can never be made less likely.
          </p>
        </section>

        <section>
          <h2>Profile</h2>
          <p className="section-meta profile-source">
            {profile.source === "gemini" ? "Read by Gemini" : "Gemini off: no profile from notes"}
            {profile.updated_at && ` · ${timeAgo(profile.updated_at)}`}
          </p>
          <ProfileList items={profile.items} empty="Nothing in the notes changes how the engine behaves." />
          {profile.dropped.length > 0 && (
            <details className="dropped">
              <summary>Not used ({profile.dropped.length})</summary>
              <ul>
                {profile.dropped.map((d, i) => (
                  <li key={i}><q>{d.evidence}</q> {d.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
