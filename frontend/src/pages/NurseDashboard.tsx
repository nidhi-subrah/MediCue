import { useCallback, useEffect, useState } from "react";
import type { Alert, PatientTrend } from "@shared/types";
import { api, useChannel } from "../api";
import AlertCard from "../components/AlertCard";
import Sparkline from "../components/Sparkline";

const SPARKS: { metric: string; label: string; format: (v: number) => string }[] = [
  { metric: "pain_needs", label: "Pain requests / 24 h", format: (v) => v.toFixed(0) },
  { metric: "high_risk", label: "High-risk signals / 24 h", format: (v) => v.toFixed(0) },
  { metric: "avg_tap_interval", label: "Seconds per tap", format: (v) => `${v.toFixed(1)} s` },
  { metric: "avg_taps", label: "Taps per need", format: (v) => v.toFixed(1) },
];

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch { /* audio blocked until user interacts */ }
}

export default function NurseDashboard() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [trends, setTrends] = useState<PatientTrend[]>([]);
  const [showDone, setShowDone] = useState(false);

  const loadTrends = useCallback(() => api.get<PatientTrend[]>("/api/trends").then(setTrends), []);
  useEffect(() => {
    api.get<Alert[]>("/api/alerts").then(setAlerts);
    loadTrends();
    const t = window.setInterval(loadTrends, 60000);
    return () => window.clearInterval(t);
  }, [loadTrends]);

  useChannel("nurse", (m) => {
    if (m.type === "alert") {
      setAlerts((a) => [m.alert, ...a.filter((x) => x.id !== m.alert.id)]);
      if (m.alert.priority === "urgent") beep();
    }
    if (m.type === "alert_updated") {
      setAlerts((a) => a.map((x) => (x.id === m.alert.id ? m.alert : x)));
      if (m.alert.status === "confirmed") loadTrends();
    }
  });

  const open = alerts.filter((a) => a.status === "open")
    .sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent"));
  const done = alerts.filter((a) => a.status !== "open");

  return (
    <div className="dashboard">
      <section aria-labelledby="alerts-h">
        <h2 id="alerts-h">Live alerts <span className="count">{open.length}</span></h2>
        {open.length === 0 && <p className="muted">No open alerts. Open a patient tablet from the home page to send one.</p>}
        {open.map((a) => <AlertCard key={a.id} alert={a} />)}
        {done.length > 0 && (
          <button className="btn small" onClick={() => setShowDone(!showDone)}>
            {showDone ? "Hide" : "Show"} {done.length} confirmed
          </button>
        )}
        {showDone && done.map((a) => <AlertCard key={a.id} alert={a} />)}
      </section>

      <section aria-labelledby="trends-h">
        <h2 id="trends-h">Catch It Early</h2>
        <p className="muted small">Each patient's last 24 h compared with their own previous 7 days. Flags are prompts
          for clinical review, not diagnoses.</p>
        {trends.map((t) => (
          <article key={t.patient_id} className="card trend">
            <header className="alert-head">
              <strong>{t.patient_name}</strong><span className="muted">Room {t.room}</span>
              {t.mode_changes_24h > 0 && <span className="tag">{t.mode_changes_24h} access-mode change(s) in 24 h</span>}
              {t.flags.length === 0 && <span className="muted small push">✓ stable</span>}
            </header>
            {t.flags.map((f) => (
              <p key={f.metric} className={`flag flag-${f.severity}`}>
                <span className="flag-icon" aria-hidden>{f.severity === "attention" ? "▲▲" : "▲"}</span>
                <span><strong>{f.severity === "attention" ? "Needs attention" : "Review"}:</strong> {f.message}</span>
              </p>
            ))}
            <div className="sparks">
              {SPARKS.map((sp) => (
                <Sparkline key={sp.metric} values={t.series[sp.metric] ?? []} label={sp.label} format={sp.format}
                           flagged={t.flags.some((f) => f.metric === sp.metric)} />
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
