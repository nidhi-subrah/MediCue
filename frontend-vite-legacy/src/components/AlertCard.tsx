import { useState } from "react";
import type { Alert } from "@shared/types";
import { api, pct, timeAgo } from "../api";
import { catalog, needLabel } from "../catalog";
import BeliefBars from "./BeliefBars";

const SBAR_ROWS = [
  ["situation", "Situation"], ["background", "Background"], ["assessment", "Assessment"], ["recommendation", "Recommendation"],
] as const;

export default function AlertCard({ alert }: { alert: Alert }) {
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urgent = alert.priority === "urgent";
  const open = alert.status === "open";
  const [lead, ...rest] = alert.top;

  const confirm = async (needId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/alerts/${alert.id}/confirm`, { need_id: needId });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`alert ${urgent ? "alert-urgent" : "alert-routine"} ${open ? "" : "alert-done"}`}
             aria-label={`${urgent ? "Urgent" : "Routine"} alert for ${alert.patient_name}`}>
      <header className="alert-head">
        <span className="alert-room">{alert.room}</span>
        <span className="alert-name">{alert.patient_name}</span>
        <span className="alert-priority">{urgent ? "Urgent" : "Routine"}</span>
        <span className="alert-time">{timeAgo(alert.created_at)} · alert in {alert.seconds_to_alert}s</span>
      </header>

      {alert.kind === "need" && lead && (
        <div className="alert-lead">
          <span className="lead-need">{lead.label}</span>
          <span className="lead-p">{pct(lead.p)}</span>
          {rest.length > 0 && (
            <span className="lead-rest">or {rest.slice(0, 2).map((t) => `${t.label.toLowerCase()} ${pct(t.p)}`).join(", ")}</span>
          )}
        </div>
      )}

      <dl className="sbar">
        {SBAR_ROWS.map(([k, label]) => (
          <div key={k}><dt>{label}</dt><dd>{alert.sbar[k]}</dd></div>
        ))}
      </dl>

      {alert.kind === "need" && (
        <details className="alert-more">
          <summary>How it got here · {pct(alert.p_high)} high-risk</summary>
          <p className="alert-reason">{alert.reason}</p>
          <BeliefBars items={alert.top} set={alert.prediction_set} />
          {alert.asked.length > 0 && (
            <ul className="facts">{alert.asked.map((a, i) => <li key={i}>Asked “{a.question}”: <strong>{a.answer}</strong></li>)}</ul>
          )}
          {alert.consults.length > 0 && (
            <ul className="facts">{alert.consults.map((c, i) => <li key={i}>{c.person} said: <strong>{c.answer}</strong></li>)}</ul>
          )}
          {alert.lookups.length > 0 && (
            <ul className="facts">
              {alert.lookups.map((l, i) => <li key={i} className={l.flag ? "flagged" : ""}>{l.label}: {l.value}</li>)}
            </ul>
          )}
          <p className="alert-source">Summary {alert.sbar_source === "gemini" ? "written by Gemini from the engine's data" : "from template (Gemini off)"}</p>
        </details>
      )}

      {open ? (
        alert.kind === "need" ? (
          <div className="confirm-row" aria-label="Confirm what the patient needed">
            <span className="confirm-label">They needed</span>
            {alert.prediction_set.slice(0, 4).map((n) => (
              <button key={n} className="btn" disabled={busy} onClick={() => confirm(n)}>{needLabel(n)}</button>
            ))}
            <select value={other} disabled={busy} aria-label="Something else"
                    onChange={(e) => { setOther(e.target.value); if (e.target.value) confirm(e.target.value); }}>
              <option value="">Something else…</option>
              {catalog.needs.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </div>
        ) : (
          <div className="confirm-row"><button className="btn btn-primary" disabled={busy} onClick={() => confirm(null)}>Acknowledge</button></div>
        )
      ) : (
        <p className="confirmed">Confirmed{alert.confirmed_need ? `: ${needLabel(alert.confirmed_need)}` : ""}</p>
      )}
      {error && <p className="error small">{error}</p>}
    </article>
  );
}
