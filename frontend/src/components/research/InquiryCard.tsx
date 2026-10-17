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
    <article className="inquiry" aria-label={`Question for ${inquiry.clinician_name}`}>
      <p className="finding-meta">
        <span className="finding-status">For {inquiry.clinician_name}</span>
        <span>{inquiry.clinician_role}</span>
        <span>{timeAgo(inquiry.created_at)}</span>
      </p>
      <p className="inquiry-q">{inquiry.question}</p>
      <input aria-label="Optional note" placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="review-row">
        <button className="btn" disabled={busy} onClick={() => answer("agree")}>Agree</button>
        <button className="btn" disabled={busy} onClick={() => answer("disagree")}>Disagree</button>
        <button className="btn btn-quiet" disabled={busy} onClick={() => answer("unsure")}>Unsure</button>
      </div>
    </article>
  );
}
