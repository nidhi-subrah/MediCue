import { useState } from "react";
import type { HypothesisStatus, ResearchHypothesis } from "@shared/types";
import { api, pct } from "../../api";
import { needLabel } from "../../catalog";

export const STATUS_LABEL: Record<HypothesisStatus, string> = {
  INVESTIGATING: "Investigating",
  WAITING_FOR_CLINICIAN: "Waiting for a clinician",
  INCONCLUSIVE: "Inconclusive, still watching",
  SUPPORTED_PENDING_REVIEW: "Supported, awaiting review",
  REJECTED_PENDING_REVIEW: "Not supported, awaiting review",
  VALIDATED: "Validated",
  REJECTED: "Rejected",
};

const ACTION_LABEL: Record<string, string> = {
  CHECK_DATA: "Check data", ASK_CLINICIAN: "Ask clinician", WAIT: "Wait", REVIEW: "Clinical lead review",
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayHhmm = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Confidence with the two review thresholds marked on the track. */
function Confidence({ h }: { h: ResearchHypothesis }) {
  return (
    <div className="confidence">
      <span className="confidence-value">{pct(h.confidence)}</span>
      <span className="confidence-track" role="img"
            aria-label={`Confidence ${pct(h.confidence)}; review below ${pct(h.thresholds.reject)} or above ${pct(h.thresholds.support)}`}>
        <span className="confidence-fill" style={{ width: `${h.confidence * 100}%` }} />
        <span className="confidence-tick" style={{ left: `${h.thresholds.reject * 100}%` }} />
        <span className="confidence-tick" style={{ left: `${h.thresholds.support * 100}%` }} />
      </span>
      <span className="confidence-note">review at {pct(h.thresholds.reject)} / {pct(h.thresholds.support)}</span>
    </div>
  );
}

export default function HypothesisCard({ h, mode }: { h: ResearchHypothesis; mode: "active" | "review" | "history" }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const supporting = h.evidence.reduce((n, e) => n + e.supports, 0);
  const contradicting = h.evidence.reduce((n, e) => n + e.contradicts, 0);
  const trace = h.decision_trace;
  const eff = h.prior_effect;

  const review = async (decision: "validated" | "rejected" | "needs_more_data") => {
    setBusy(true);
    try {
      await api.post(`/api/research/hypotheses/${h.id}/review`, { decision, note: note || null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`finding hyp hyp-${h.status.toLowerCase()}`}>
      <p className="finding-meta">
        <span className="finding-status">{STATUS_LABEL[h.status]}</span>
        <span>{h.origin === "clinician" ? "Clinician observation" : "System detected"}</span>
        <span>{h.cohort}</span>
      </p>
      <h2 className="finding-title">{h.statement}</h2>
      {h.observation_text && (
        <blockquote className="observation">“{h.observation_text}” <cite>{h.origin_detail}</cite></blockquote>
      )}

      <Confidence h={h} />

      <dl className="finding-body">
        <div>
          <dt>Evidence</dt>
          <dd><span className="ev-plus">+{supporting} supporting</span> · <span className="ev-minus">−{contradicting} contradicting</span></dd>
        </div>
        {h.origin === "system" && <div><dt>Origin</dt><dd>{h.origin_detail}. {h.discovery}</dd></div>}
        <div><dt>Last action</dt><dd>{h.last_action ? ACTION_LABEL[h.last_action] : "None yet"}</dd></div>
        {h.next_action && <div><dt>Next action</dt><dd>{h.next_action.label}</dd></div>}
        {h.rationale && mode !== "history" && (
          <div><dt>Possible reason</dt><dd>{h.rationale}{h.rationale_source === "gemini" && <span className="by"> (drafted by Gemini)</span>}</dd></div>
        )}
        {eff && (
          <div>
            <dt>{h.status === "VALIDATED" ? "Now applied" : "If validated"}</dt>
            <dd>
              {eff.need_ids.map(needLabel).join(", ")} made {eff.multiplier}× more likely
              {eff.after_visit_h ? ` for ${eff.after_visit_h} h after a family visit ends` : ""}
              {eff.hours ? ` from ${eff.hours[0]}:00 to ${eff.hours[eff.hours.length - 1] + 1}:00` : ""}
            </dd>
          </div>
        )}
        {mode === "history" && h.reviewer && <div><dt>Reviewed</dt><dd>{h.reviewer}{h.note ? `: “${h.note}”` : ""}</dd></div>}
      </dl>

      {trace && mode !== "history" && (
        <details className="alert-more">
          <summary>Agent decision trace</summary>
          <p className="research-note">
            Scores from the research decision engine at {pct(trace.confidence)} confidence ({hhmm(trace.t)}).
            Score = expected information gain in bits minus costs. Deterministic arithmetic, not LLM reasoning.
          </p>
          <div className="table-wrap">
            <table className="scores">
              <thead><tr><th>Action</th><th>Info gain</th><th>Cost</th><th>Score</th></tr></thead>
              <tbody>
                {trace.ranked.map((a, i) => (
                  <tr key={a.kind + (a.target ?? "")} className={i === 0 ? "chosen" : ""}>
                    <td>
                      {a.kind}{a.target ? ` · ${a.label.replace(/^Ask /, "")}` : ""}
                      {"clinician_reliability" in a.detail && (
                        <span className="score-detail">reliability {Number(a.detail.clinician_reliability).toFixed(2)}{a.detail.note ? `, ${a.detail.note}` : ""}</span>
                      )}
                      {"new_episodes" in a.detail && <span className="score-detail">{a.detail.new_episodes} new episode(s)</span>}
                    </td>
                    <td>{a.eig.toFixed(2)}</td>
                    <td title={Object.entries(a.costs).map(([k, v]) => `${k.replace("_", " ")} ${v.toFixed(2)}`).join(", ")}>
                      {Object.values(a.costs).reduce((x, y) => x + y, 0).toFixed(2)}
                      {Object.keys(a.costs).length > 0 && (
                        <span className="score-detail">{Object.entries(a.costs).map(([k, v]) => `${k.replace("_", " ")} ${v.toFixed(2)}`).join(", ")}</span>
                      )}
                    </td>
                    <td>{a.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="research-note">Selected: <strong>{trace.selected}</strong></p>
        </details>
      )}

      <details className="alert-more" open={mode === "review"}>
        <summary>Timeline ({h.timeline.length})</summary>
        <ol className="trace timeline">
          {h.timeline.map((t, i) => (
            <li key={i} className={`tl-${t.kind}`}>
              <time className="trace-kind" dateTime={t.t}>{mode === "history" ? dayHhmm(t.t) : hhmm(t.t)}</time>
              <span>{t.text}</span>
            </li>
          ))}
        </ol>
      </details>

      {h.evidence.length > 0 && (
        <details className="alert-more">
          <summary>Evidence trail ({h.evidence.length})</summary>
          <ol className="trace">
            {h.evidence.map((e) => (
              <li key={e.id}>
                <span className="trace-kind">{e.source}</span>
                <span>{e.summary}</span>
                <span className="trace-top">confidence {pct(e.confidence_before)} → {pct(e.confidence_after)}</span>
                {e.episodes && e.episodes.length > 0 && (
                  <ul className="episodes">
                    {e.episodes.map((ep, i) => (
                      <li key={i}><span className={ep.supports ? "ev-plus" : "ev-minus"}>{ep.supports ? "+" : "−"}</span> {dayHhmm(ep.time)} · {ep.label}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      {mode === "review" && (
        <div className="review-row">
          <input aria-label="Reviewer note" placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} onClick={() => review("validated")}>Validate</button>
          <button className="btn" disabled={busy} onClick={() => review("needs_more_data")}>Needs more data</button>
          <button className="btn btn-quiet" disabled={busy} onClick={() => review("rejected")}>Reject</button>
        </div>
      )}
    </article>
  );
}
