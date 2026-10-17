import { useEffect, useState } from "react";
import type { Finding } from "@shared/types";
import { api, timeAgo } from "../api";
import { needLabel } from "../catalog";

const STATUS_LABEL: Record<Finding["status"], string> = {
  proposed: "Awaiting review", validated: "Validated", rejected: "Rejected", needs_more_data: "Needs more data",
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

  const waiting = findings.filter((f) => f.status === "proposed").length;

  return (
    <div className="research">
      <header className="section-head research-head">
        <div>
          <h1>Pattern review</h1>
          <p className="section-meta">{waiting} awaiting review · {findings.length} total</p>
        </div>
        <button className="btn" onClick={run} disabled={running}>{running ? "Analysing…" : "Scan for new patterns"}</button>
      </header>
      <p className="research-intro">
        Patterns found in confirmed requests. Validating one adjusts that patient's starting probabilities;
        rejected patterns are not proposed again.
      </p>

      {findings.length === 0 && <p className="empty">No patterns yet.</p>}
      {findings.map((f) => (
        <article key={f.id} className={`finding status-${f.status}`}>
          <p className="finding-meta">
            <span className="finding-status">{STATUS_LABEL[f.status]}</span>
            <span>{f.kind.replace(/_/g, " ")}</span>
            <span>first seen {timeAgo(f.created_at)}</span>
          </p>
          <h2 className="finding-title">{f.title}</h2>
          <dl className="finding-body">
            <div><dt>Evidence</dt><dd>{f.evidence}</dd></div>
            <div>
              <dt>Hypothesis</dt>
              <dd>{f.hypothesis}{f.hypothesis_source === "gemini" && <span className="by"> (drafted by Gemini)</span>}</dd>
            </div>
            {f.prior_effect && (
              <div>
                <dt>If validated</dt>
                <dd>
                  {f.prior_effect.need_ids.map(needLabel).join(", ")} made {f.prior_effect.multiplier}× more likely
                  {f.prior_effect.hours ? ` from ${f.prior_effect.hours[0]}:00 to ${f.prior_effect.hours[f.prior_effect.hours.length - 1] + 1}:00` : ""}
                </dd>
              </div>
            )}
            {f.reviewer && <div><dt>Reviewed</dt><dd>{f.reviewer}{f.note ? `: “${f.note}”` : ""}</dd></div>}
          </dl>
          <div className="review-row">
            <input aria-label="Reviewer note" placeholder="Add a note (optional)" value={notes[f.id] ?? ""}
                   onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
            <button className="btn" onClick={() => review(f, "validated")}>Validate</button>
            <button className="btn" onClick={() => review(f, "needs_more_data")}>Needs more data</button>
            <button className="btn btn-quiet" onClick={() => review(f, "rejected")}>Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}
