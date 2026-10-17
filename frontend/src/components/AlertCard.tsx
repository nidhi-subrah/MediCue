import { useState } from "react";
import type { Alert } from "@shared/types";
import { api, pct, timeAgo } from "../api";
import { catalog, needLabel } from "../catalog";
import BeliefBars from "./BeliefBars";

export default function AlertCard({ alert }: { alert: Alert }) {
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const urgent = alert.priority === "urgent";
  const open = alert.status === "open";

  const confirm = async (needId: string | null) => {
    setBusy(true);
    try {
      await api.post(`/api/alerts/${alert.id}/confirm`, { need_id: needId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`card alert ${urgent ? "alert-urgent" : ""} ${open ? "" : "alert-done"}`}
             aria-label={`${urgent ? "Urgent" : "Routine"} alert for ${alert.patient_name}`}>
      <header className="alert-head">
        <span className={`badge ${urgent ? "badge-urgent" : "badge-routine"}`}>
          {urgent ? "⚠ URGENT" : "● Routine"}
        </span>
        <strong>{alert.patient_name}</strong>
        <span className="muted">Room {alert.room}</span>
        <span className="muted small push">{timeAgo(alert.created_at)} · first tap → alert {alert.seconds_to_alert}s</span>
      </header>

      <dl className="sbar">
        <dt>S</dt><dd>{alert.sbar.situation}</dd>
        <dt>B</dt><dd>{alert.sbar.background}</dd>
        <dt>A</dt><dd>{alert.sbar.assessment}</dd>
        <dt>R</dt><dd>{alert.sbar.recommendation}</dd>
      </dl>
      <p className="muted small">
        Summary: {alert.sbar_source === "gemini" ? "written by Gemini from the structured data" : "template"}
        {alert.kind === "need" && <> · Why {urgent ? "escalated" : "sent"} (at the time): {alert.reason}</>}
      </p>

      {alert.kind === "need" && (
        <details>
          <summary>Belief, questions and chart ({pct(alert.p_high)} high-risk)</summary>
          <BeliefBars items={alert.top} set={alert.prediction_set} />
          {alert.asked.length > 0 && (
            <ul className="small">{alert.asked.map((a, i) => <li key={i}>“{a.question}” → <strong>{a.answer}</strong></li>)}</ul>
          )}
          {alert.consults.length > 0 && (
            <ul className="small">{alert.consults.map((c, i) => <li key={i}>{c.person}: {c.answer}</li>)}</ul>
          )}
          <ul className="small chart-list">
            {alert.lookups.map((l, i) => <li key={i} className={l.flag ? "flagged" : ""}>{l.flag ? "▲ " : ""}{l.label}: {l.value}</li>)}
          </ul>
        </details>
      )}

      {open ? (
        alert.kind === "need" ? (
          <div className="confirm-row" aria-label="Confirm what the patient needed">
            <span className="small">What did they need?</span>
            {alert.prediction_set.slice(0, 4).map((n) => (
              <button key={n} className="btn" disabled={busy} onClick={() => confirm(n)}>{needLabel(n)}</button>
            ))}
            <select value={other} disabled={busy} onChange={(e) => { setOther(e.target.value); if (e.target.value) confirm(e.target.value); }}>
              <option value="">Other…</option>
              {catalog.needs.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </div>
        ) : (
          <div className="confirm-row"><button className="btn primary" disabled={busy} onClick={() => confirm(null)}>Acknowledge</button></div>
        )
      ) : (
        <p className="small">✓ Confirmed{alert.confirmed_need ? `: ${needLabel(alert.confirmed_need)}` : ""}</p>
      )}
    </article>
  );
}
