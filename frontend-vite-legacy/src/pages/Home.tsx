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
      <header className="home-intro">
        <h1>Demo console</h1>
        <p>
          Open a bedside tablet for one of the synthetic patients below, and the nurse station in another window.
          Requests travel from the tablet to the nurse in real time.
        </p>
        <nav className="home-links" aria-label="Staff views">
          <a href="#/nurse">Nurse station</a>
          <a href="#/research">Pattern review</a>
        </nav>
      </header>

      {error && <p className="error">Can't reach the backend. Is it running on port 8000? ({error})</p>}

      <table className="patients">
        <caption>Patients</caption>
        <thead>
          <tr><th>Room</th><th>Patient</th><th>Situation</th><th>Open as</th></tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id}>
              <td className="room">{p.room}</td>
              <td><span className="pt-name">{p.name}</span><span className="pt-age">{p.age}</span></td>
              <td className="dx">{p.diagnosis}</td>
              <td className="open-as">
                <a href={`#/patient/${p.id}`}>Bedside tablet</a>
                {p.people.map((person) => (
                  <a key={person.id} href={`#/family/${person.id}`}>{person.name.split(" ")[0]}, {person.relation}</a>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
