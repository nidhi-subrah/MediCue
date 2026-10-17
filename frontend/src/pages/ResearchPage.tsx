import { useEffect, useState } from "react";
import type { Finding } from "@shared/types";
import { api, timeAgo } from "../api";
import { needLabel } from "../catalog";

const STATUS_LABEL: Record<Finding["status"], string> = {
  proposed: "Proposed", validated: "✓ Validated", rejected: "✕ Rejected", needs_more_data: "… Needs more data",
};

export default function ResearchPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const load = () => api.get<Finding[]>("/api/research/findings").then(setFindings);
  useEffect(() => { load(); }, []);

  const run = async () => {
    setRunning(true);
    try { await api.post("/api/research/run"); await load(); } finally { setRunning(false); }
  };

  const review = async (f: Finding, status: Finding["status"]) => {
    const updated = await api.post<Finding>(`/api/research/findings/${f.id}/review`, { status, note: notes[f.id] ?? null });
    setFindings((all) => all.map((x) => (x.id === f.id ? updated : x)));
  };

  return (
    <div className="research">
      <header className="research-head">
        <div>
          <h1>Pattern review</h1>
          <p className="muted small">The system scans confirmed needs for recurring patterns, an agent drafts a hypothesis,
            and you decide. Validated findings adjust that patient's prior. Rejected ones are never proposed again.</p>
        </div>
        <button className="btn primary" onClick={run} disabled={running}>{running ? "Analysing…" : "Run analysis"}</button>
      </header>

      {findings.length === 0 && <p className="muted">No findings yet.</p>}
      {findings.map((f) => (
        <article key={f.id} className={`card finding status-${f.status}`}>
          <header className="alert-head">
            <span className="tag">{f.kind.replace(/_/g, " ")}</span>
            <strong>{f.title}</strong>
            <span className="push small">{STATUS_LABEL[f.status]}</span>
          </header>
          <p><strong>Evidence:</strong> {f.evidence}</p>
          <p><strong>Hypothesis</strong> <span className="muted small">({f.hypothesis_source === "gemini" ? "Gemini" : "template"})</span>: {f.hypothesis}</p>
          {f.prior_effect && (
            <p className="small muted">If validated: prior × {f.prior_effect.multiplier} for {f.prior_effect.need_ids.map(needLabel).join(", ")}
              {f.prior_effect.hours ? ` between ${f.prior_effect.hours[0]}:00 and ${f.prior_effect.hours[f.prior_effect.hours.length - 1] + 1}:00` : ""}.</p>
          )}
          {f.reviewer && <p className="small">Reviewed by {f.reviewer}{f.note ? `: “${f.note}”` : ""}</p>}
          <div className="confirm-row">
            <input aria-label="Reviewer note" placeholder="Note (optional)" value={notes[f.id] ?? ""}
                   onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
            <button className="btn" onClick={() => review(f, "validated")}>Validate</button>
            <button className="btn" onClick={() => review(f, "needs_more_data")}>Needs more data</button>
            <button className="btn" onClick={() => review(f, "rejected")}>Reject</button>
          </div>
          <p className="muted small">First seen {timeAgo(f.created_at)}</p>
        </article>
      ))}
    </div>
  );
}
