import { useState } from "react";
import type { HypothesisStatus, ResearchHypothesis } from "@shared/types";
import { api, pct } from "../../api";

export const STATUS_LABEL: Record<HypothesisStatus, string> = {
  INVESTIGATING: "Investigating",
  WAITING_FOR_CLINICIAN: "Waiting for clinician",
  INCONCLUSIVE: "Inconclusive · watching",
  SUPPORTED_PENDING_REVIEW: "Supported · pending review",
  REJECTED_PENDING_REVIEW: "Not supported · pending review",
  VALIDATED: "✓ Validated",
  REJECTED: "✕ Rejected",
};

const ACTION_LABEL: Record<string, string> = {
  CHECK_DATA: "Check data", ASK_CLINICIAN: "Ask clinician", WAIT: "Wait", REVIEW: "Clinical lead review",
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayHhmm = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Confidence bar with the review thresholds marked. */
function Confidence({ h }: { h: ResearchHypothesis }) {
  return (
    <div className="confidence" aria-label={`Confidence ${pct(h.confidence)}`}>
      <span className="confidence-value">{pct(h.confidence)}</span>
      <span className="confidence-track" aria-hidden>
        <span className="confidence-fill" style={{ width: `${h.confidence * 100}%` }} />
        <span className="confidence-tick" style={{ left: `${h.thresholds.reject * 100}%` }} title={`Reject threshold ${pct(h.thresholds.reject)}`} />
        <span className="confidence-tick" style={{ left: `${h.thresholds.support * 100}%` }} title={`Support threshold ${pct(h.thresholds.support)}`} />
      </span>
      <span className="muted small">review at ≤{pct(h.thresholds.reject)} or ≥{pct(h.thresholds.support)}</span>
    </div>
  );
}

export default function HypothesisCard({ h, mode }: { h: ResearchHypothesis; mode: "active" | "review" | "history" }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const supporting = h.evidence.reduce((n, e) => n + e.supports, 0);
  const contradicting = h.evidence.reduce((n, e) => n + e.contradicts, 0);
  const trace = h.decision_trace;

  const review = async (decision: "validated" | "rejected" | "needs_more_data") => {
    setBusy(true);
    try {
      await api.post(`/api/research/hypotheses/${h.id}/review`, { decision, note: note || null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`card finding hyp status-${h.status.toLowerCase()}`}>
      <header className="alert-head">
        <span className={`tag ${h.origin === "clinician" ? "tag-clinician" : ""}`}>
          {h.origin === "clinician" ? "Clinician observation" : "System detected"}
        </span>
        <span className="muted small">{h.cohort}</span>
        <span className="push small hyp-status">{STATUS_LABEL[h.status]}</span>
      </header>

      <h3 className="hyp-statement">{h.statement}</h3>
      {h.observation_text && (
        <blockquote className="observation">“{h.observation_text}” <span className="muted">— {h.origin_detail}</span></blockquote>
      )}
      {h.origin === "system" && <p className="muted small">Origin: {h.origin_detail}. {h.discovery}</p>}

      <Confidence h={h} />

      <dl className="hyp-facts">
        <div><dt>Evidence</dt><dd><span className="ev-plus">+{supporting} supporting</span> · <span className="ev-minus">−{contradicting} contradicting</span></dd></div>
        <div><dt>Last action</dt><dd>{h.last_action ? ACTION_LABEL[h.last_action] : "—"}</dd></div>
        <div><dt>Next action</dt><dd>{h.next_action ? h.next_action.label : "—"}</dd></div>
      </dl>

      {trace && mode !== "history" && (
        <details>
          <summary>Agent decision trace</summary>
          <p className="muted small">Deterministic scores from the research decision engine at confidence {pct(trace.confidence)} ({hhmm(trace.t)}).
            Score = expected information gain (bits) − costs. Not LLM reasoning.</p>
          <div className="table-wrap">
            <table className="actions">
              <thead><tr><th>Action</th><th>Info gain</th><th>Costs</th><th>Score</th></tr></thead>
              <tbody>
                {trace.ranked.map((a, i) => (
                  <tr key={a.kind + (a.target ?? "")} className={i === 0 ? "chosen" : ""}>
                    <td>
                      <strong>{a.kind}</strong>{a.target ? ` — ${a.label.replace(/^Ask /, "")}` : ""}
                      {"clinician_reliability" in a.detail && <div className="muted small">reliability {Number(a.detail.clinician_reliability).toFixed(2)}{a.detail.note ? ` (${a.detail.note})` : ""}</div>}
                      {"new_episodes" in a.detail && <div className="muted small">{a.detail.new_episodes} new episode(s)</div>}
                    </td>
                    <td>{a.eig.toFixed(2)}</td>
                    <td>{Object.entries(a.costs).map(([k, v]) => `${k.replace("_", " ")} ${v.toFixed(2)}`).join(", ") || "—"}</td>
                    <td>{a.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">Selected: <strong>{trace.selected}</strong></p>
        </details>
      )}

      <details open={mode === "review"}>
        <summary>Timeline ({h.timeline.length})</summary>
        <ol className="timeline">
          {h.timeline.map((t, i) => (
            <li key={i} className={`tl-${t.kind}`}>
              <time dateTime={t.t}>{mode === "history" ? dayHhmm(t.t) : hhmm(t.t)}</time>
              <span>{t.text}</span>
            </li>
          ))}
        </ol>
      </details>

      {h.evidence.length > 0 && (
        <details>
          <summary>Evidence trail ({h.evidence.length})</summary>
          <ul className="evidence">
            {h.evidence.map((e) => (
              <li key={e.id}>
                <span className="tag">{e.source === "data" ? "data" : "clinician"}</span> {e.summary}
                <span className="muted small"> · {pct(e.confidence_before)} → {pct(e.confidence_after)}</span>
                {e.episodes && e.episodes.length > 0 && (
                  <ul className="episodes small">
                    {e.episodes.map((ep, i) => (
                      <li key={i}>{ep.supports ? "＋" : "－"} {dayHhmm(ep.time)} · {ep.label}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {h.rationale && mode !== "history" && (
        <p className="small muted">Possible explanation ({h.rationale_source === "gemini" ? "Gemini" : "template"}): {h.rationale}</p>
      )}
      {h.prior_effect && (
        <p className="small muted">
          {h.status === "VALIDATED" ? "Now shaping" : "If validated, will shape"} this patient's prior:
          × {h.prior_effect.multiplier}{h.prior_effect.after_visit_h ? ` for ${h.prior_effect.after_visit_h} h after a family visit ends` : ""}
          {h.prior_effect.hours ? ` between ${h.prior_effect.hours[0]}:00 and ${h.prior_effect.hours[h.prior_effect.hours.length - 1] + 1}:00` : ""}.
        </p>
      )}

      {mode === "review" && (
        <div className="confirm-row">
          <input aria-label="Reviewer note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn primary" disabled={busy} onClick={() => review("validated")}>Validate</button>
          <button className="btn" disabled={busy} onClick={() => review("needs_more_data")}>Needs more data</button>
          <button className="btn" disabled={busy} onClick={() => review("rejected")}>Reject</button>
        </div>
      )}
      {mode === "history" && h.reviewer && (
        <p className="small">Reviewed by {h.reviewer}{h.note ? `: “${h.note}”` : ""}</p>
      )}
    </article>
  );
}
