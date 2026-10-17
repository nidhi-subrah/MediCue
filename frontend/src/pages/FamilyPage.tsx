import { useEffect, useState } from "react";
import type { ConsultRequest } from "@shared/types";
import { api, timeAgo, useChannel } from "../api";

interface PersonInfo { id: string; name: string; relation: string; patient_id: string; patient_name: string }

export default function FamilyPage({ personId }: { personId: string }) {
  const [me, setMe] = useState<PersonInfo | null>(null);
  const [consults, setConsults] = useState<ConsultRequest[]>([]);
  const [welfare, setWelfare] = useState<{ id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<PersonInfo>(`/api/people/${personId}`).then(setMe).catch((e) => setError(String(e)));
    api.get<ConsultRequest[]>(`/api/consults?person_id=${personId}`).then(setConsults);
  }, [personId]);

  useChannel(`family:${personId}`, (m) => {
    if (m.type === "consult") setConsults((c) => [m.consult, ...c.filter((x) => x.id !== m.consult.id)]);
    if (m.type === "welfare_resolved" && welfare?.id === m.id) setWelfare({ id: m.id, status: m.outcome });
  });

  const answer = async (c: ConsultRequest, needId: string | null, unsure = false) => {
    const updated = await api.post<ConsultRequest>(`/api/consults/${c.id}/answer`, { need_id: needId, unsure });
    setConsults((all) => all.map((x) => (x.id === c.id ? updated : x)));
  };

  const checkIn = async () => {
    if (!me) return;
    try {
      const w = await api.post<{ id: string; status: string }>("/api/welfare", { patient_id: me.patient_id, requested_by: personId });
      setWelfare(w);
    } catch (e) {
      setError(String(e));
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!me) return <p>Loading…</p>;
  const pending = consults.filter((c) => c.status === "pending");
  const past = consults.filter((c) => c.status !== "pending");

  return (
    <div className="family">
      <h1>Hi {me.name.split(" ")[0]}</h1>
      <p className="muted">You're helping the care team understand {me.patient_name}.</p>

      {pending.length === 0 && <div className="card"><p>No questions right now. We'll show one here when {me.patient_name.split(" ")[0]} needs your help.</p></div>}
      {pending.map((c) => (
        <article key={c.id} className="card consult" aria-live="polite">
          <p className="consult-q">{c.question}</p>
          <div className="consult-options">
            {c.options.map((o) => <button key={o.need} className="btn big" onClick={() => answer(c, o.need)}>{o.label}</button>)}
            <button className="btn big" onClick={() => answer(c, null)}>Something else</button>
            <button className="btn big muted-btn" onClick={() => answer(c, null, true)}>I'm not sure</button>
          </div>
          <p className="muted small">{timeAgo(c.created_at)}</p>
        </article>
      ))}

      <section className="card">
        <h2>Welfare check</h2>
        <p className="small">If you're worried, ask {me.patient_name.split(" ")[0]} to respond on their tablet. If there's no
          response in time, their nurse is alerted. This only notices a missed response; it can't tell why.</p>
        <button className="btn primary" onClick={checkIn} disabled={welfare?.status === "pending"}>
          Check on {me.patient_name.split(" ")[0]}
        </button>
        {welfare && (
          <p className="small" aria-live="polite">
            {welfare.status === "pending" && "Waiting for a response…"}
            {welfare.status === "responded" && "✓ They responded."}
            {welfare.status === "no_response" && "No response. Their nurse has been alerted."}
          </p>
        )}
      </section>

      {past.length > 0 && (
        <details>
          <summary>Earlier questions ({past.length})</summary>
          <ul className="small">{past.map((c) => <li key={c.id}>{c.question} · {c.status}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
