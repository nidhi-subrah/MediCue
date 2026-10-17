import { useState } from "react";
import type { ResearchInquiry } from "@shared/types";
import { api, timeAgo } from "../../api";

export default function InquiryCard({ inquiry }: { inquiry: ResearchInquiry }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const answer = async (response: "agree" | "disagree" | "unsure") => {
    setBusy(true);
    try {
      await api.post(`/api/research/inquiries/${inquiry.id}/answer`, { response, note: note || null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card inquiry" aria-label={`Question for ${inquiry.clinician_name}`}>
      <p className="muted small">SilentSignal Research asks <strong>{inquiry.clinician_name}</strong> ({inquiry.clinician_role}) · {timeAgo(inquiry.created_at)}</p>
      <p className="consult-q">{inquiry.question}</p>
      <input aria-label="Optional note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="inquiry-actions">
        <button className="btn" disabled={busy} onClick={() => answer("agree")}>Agree</button>
        <button className="btn" disabled={busy} onClick={() => answer("disagree")}>Disagree</button>
        <button className="btn muted-btn" disabled={busy} onClick={() => answer("unsure")}>Unsure</button>
      </div>
    </article>
  );
}
