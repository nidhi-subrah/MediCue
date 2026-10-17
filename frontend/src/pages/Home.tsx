import { useEffect, useState } from "react";
import type { Patient } from "@shared/types";
import { api } from "../api";

export default function Home() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Patient[]>("/api/patients").then(setPatients).catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="home">
      <header className="hero">
        <h1>SilentSignal</h1>
        <p>A few taps from a patient who cannot speak become a precise, structured message for the care team,
          with an honest statement of how sure the system is.</p>
      </header>

      <section className="roles">
        <a className="role-card" href="#/nurse">
          <h2>Nurse dashboard</h2>
          <p>Live alerts in SBAR format, one-tap confirmation, and Catch It Early trend flags.</p>
        </a>
        <a className="role-card" href="#/research">
          <h2>Clinical lead</h2>
          <p>Review patterns the system surfaced. Validate, reject or ask for more data.</p>
        </a>
      </section>

      {error && <p className="error">Backend unreachable: {error}</p>}
      <h2>Patients (synthetic)</h2>
      <div className="patient-list">
        {patients.map((p) => (
          <div key={p.id} className="card patient-row">
            <div>
              <strong>{p.name}</strong>, {p.age} · Room {p.room}
              <div className="muted small">{p.diagnosis}</div>
            </div>
            <div className="row-actions">
              <a className="btn primary" href={`#/patient/${p.id}`}>Patient tablet</a>
              {p.people.map((person) => (
                <a key={person.id} className="btn" href={`#/family/${person.id}`}>
                  {person.name} ({person.relation})
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
