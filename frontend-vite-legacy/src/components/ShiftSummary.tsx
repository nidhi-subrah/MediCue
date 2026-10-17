import { useEffect, useState } from "react";
import type { HandoffPatient, HandoffSummary } from "@shared/types";
import { api } from "../api";

const STATUS_LABEL = { attention: "Needs attention", watch: "Watch", stable: "No change" } as const;

function communication(p: HandoffPatient): string | null {
  const parts: string[] = [];
  if (p.tap_seconds !== null) {
    parts.push(p.baseline_seconds
      ? `taps averaged ${p.tap_seconds} s against a usual ${p.baseline_seconds} s`
      : `taps averaged ${p.tap_seconds} s`);
  }
  if (p.inconsistent_answers > 0) parts.push(`${p.inconsistent_answers} inconsistent answer${p.inconsistent_answers === 1 ? "" : "s"}`);
  if (p.mode_changes > 0) parts.push(`${p.mode_changes} access-mode change${p.mode_changes === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Feature A: fixed-structure handoff note. Numbers come from the backend; Gemini writes the headline
 *  and "watch for" lines only. */
export default function ShiftSummary({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<HandoffSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<HandoffSummary>("/api/handoff?hours=12").then(setSummary).catch((e) => setError(String(e)));
  }, []);

  return (
    <section className="handoff" aria-labelledby="handoff-h">
      <header className="section-head">
        <h2 id="handoff-h">Shift summary</h2>
        <p className="section-meta">
          {summary ? <>Last {summary.window_hours} h · {summary.source === "gemini" ? "headlines by Gemini" : "template headlines (Gemini off)"}</> : "Preparing…"}
          <button className="text-btn handoff-close" onClick={onClose}>Close</button>
        </p>
      </header>
      {error && <p className="error">{error}</p>}
      {summary && summary.patients.length === 0 && <p className="empty">Nothing to hand over: every patient was steady.</p>}
      {summary?.patients.map((p) => {
        const comm = communication(p);
        return (
          <article key={p.patient_id} className={`handoff-patient hp-${p.status}`}>
            <header className="trend-head">
              <span className="alert-room">{p.room}</span>
              <span className="alert-name">{p.name}</span>
              <span className="hp-status">{STATUS_LABEL[p.status]}</span>
            </header>
            <p className="hp-headline">{p.headline}</p>
            <dl className="hp-facts">
              <div>
                <dt>Requests</dt>
                <dd>
                  {p.requests} this shift{p.urgent > 0 && `, ${p.urgent} urgent`}
                  {p.open_urgent > 0 && <strong className="meta-urgent"> ({p.open_urgent} still open)</strong>}
                  {p.confirmed.length > 0 && <>. Confirmed: {p.confirmed.map((c) => `${c.label.toLowerCase()}${c.count > 1 ? ` ×${c.count}` : ""}`).join(", ")}</>}
                </dd>
              </div>
              {comm && <div><dt>Communication</dt><dd>{comm}</dd></div>}
              {p.trends.length > 0 && <div><dt>Trends</dt><dd>{p.trends.map((t) => t.message).join(" ")}</dd></div>}
              {p.profile.length > 0 && <div><dt>From the notes</dt><dd>{p.profile.map((q) => `“${q}”`).join(" ")}</dd></div>}
              {p.watch_for && <div><dt>Watch for</dt><dd>{p.watch_for}</dd></div>}
            </dl>
          </article>
        );
      })}
      {summary && summary.stable.length > 0 && (
        <p className="stable">No change: {summary.stable.map((s) => `${s.name} (${s.room})`).join(", ")}</p>
      )}
    </section>
  );
}
