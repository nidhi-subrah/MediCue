import { useState } from "react";
import type { ProfileSuggestion } from "@shared/types";
import { api, timeAgo } from "../api";

const STATUS_NOTE: Partial<Record<ProfileSuggestion["status"], string>> = {
  duplicate: "Already in the profile", blocked: "Not allowed", approved: "Approved", rejected: "Rejected",
};

/** Feature B: profile changes Gemini suggested from nurses' notes. Nothing applies until approved. */
export default function Suggestions({ items }: { items: ProfileSuggestion[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const review = async (s: ProfileSuggestion, approve: boolean) => {
    setBusy(s.id);
    try { await api.post(`/api/suggestions/${s.id}/review`, { approve }); } finally { setBusy(null); }
  };
  const pending = items.filter((s) => s.status === "pending");
  const recent = items.filter((s) => s.status !== "pending").slice(0, 4);
  if (items.length === 0) return null;

  return (
    <section className="suggestions" aria-labelledby="sugg-h">
      <header className="section-head">
        <h2 id="sugg-h">Profile suggestions</h2>
        <p className="section-meta">{pending.length} to review · from nurses' notes</p>
      </header>
      {[...pending, ...recent].map((s) => (
        <article key={s.id} className={`suggestion sg-${s.status}`}>
          <p className="sg-who"><span className="alert-room">{s.room}</span> {s.patient_name} · {s.nurse}, {timeAgo(s.created_at)}</p>
          <p className="sg-effect">{s.item.effect}</p>
          <q className="profile-quote">{s.item.evidence}</q>
          {s.status === "pending" ? (
            <div className="confirm-row">
              <button className="btn" disabled={busy === s.id} onClick={() => review(s, true)}>Approve</button>
              <button className="btn btn-quiet" disabled={busy === s.id} onClick={() => review(s, false)}>Reject</button>
            </div>
          ) : (
            <p className="sg-status">{STATUS_NOTE[s.status]}{s.reason && s.status !== "duplicate" ? `: ${s.reason}` : ""}</p>
          )}
        </article>
      ))}
    </section>
  );
}
