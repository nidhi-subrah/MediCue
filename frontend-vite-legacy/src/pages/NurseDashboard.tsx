import { useCallback, useEffect, useState } from "react";
import type { Alert, PatientTrend, ProfileSuggestion } from "@shared/types";
import { api, useChannel } from "../api";
import AlertCard from "../components/AlertCard";
import ShiftSummary from "../components/ShiftSummary";
import Sparkline from "../components/Sparkline";
import Suggestions from "../components/Suggestions";

const SPARKS: { metric: string; label: string; format: (v: number) => string }[] = [
  { metric: "pain_needs", label: "Pain requests", format: (v) => v.toFixed(0) },
  { metric: "high_risk", label: "High-risk signals", format: (v) => v.toFixed(0) },
  { metric: "avg_tap_interval", label: "Seconds per tap", format: (v) => `${v.toFixed(1)}s` },
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
  const [showSummary, setShowSummary] = useState(false);
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);

  const loadTrends = useCallback(() => api.get<PatientTrend[]>("/api/trends").then(setTrends), []);
  const loadAlerts = useCallback(() => api.get<Alert[]>("/api/alerts").then(setAlerts), []);
  useEffect(() => {
    loadAlerts();
    api.get<ProfileSuggestion[]>("/api/suggestions").then(setSuggestions);
    loadTrends();
    const t = window.setInterval(loadTrends, 60000);
    return () => window.clearInterval(t);
  }, [loadAlerts, loadTrends]);

  useChannel("nurse", (m) => {
    if (m.type === "alert") {
      setAlerts((a) => [m.alert, ...a.filter((x) => x.id !== m.alert.id)]);
      if (m.alert.priority === "urgent") beep();
    }
    if (m.type === "alert_updated") {
      setAlerts((a) => a.map((x) => (x.id === m.alert.id ? m.alert : x)));
      if (m.alert.status === "confirmed") loadTrends();
    }
    if (m.type === "suggestions") {
      setSuggestions((all) => {
        const ids = new Set(m.suggestions.map((s) => s.id));
        return [...m.suggestions, ...all.filter((s) => !ids.has(s.id))]
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      });
    }
  }, loadAlerts);  // refetch after a reconnect so no alert sent while offline is missed

  const open = alerts.filter((a) => a.status === "open")
    .sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent"));
  const done = alerts.filter((a) => a.status !== "open");
  const urgentCount = open.filter((a) => a.priority === "urgent").length;
  const flagged = trends.filter((t) => t.flags.length > 0);
  const stable = trends.filter((t) => t.flags.length === 0);

  return (
    <>
    {showSummary && <ShiftSummary onClose={() => setShowSummary(false)} />}
    <div className="dashboard">
      <section className="requests" aria-labelledby="alerts-h">
        <header className="section-head">
          <h1 id="alerts-h">Requests</h1>
          <p className="section-meta">
            {open.length === 0 ? "None open" : `${open.length} open`}
            {urgentCount > 0 && <span className="meta-urgent"> · {urgentCount} urgent</span>}
            {!showSummary && <button className="btn handoff-btn" onClick={() => setShowSummary(true)}>Shift summary</button>}
          </p>
        </header>
        {open.length === 0 && (
          <p className="empty">Nothing waiting. Requests from bedside tablets appear here as they're sent.</p>
        )}
        {open.map((a) => <AlertCard key={a.id} alert={a} />)}
        {done.length > 0 && (
          <button className="text-btn" onClick={() => setShowDone(!showDone)}>
            {showDone ? "Hide" : "Show"} {done.length} confirmed
          </button>
        )}
        {showDone && done.map((a) => <AlertCard key={a.id} alert={a} />)}
      </section>

      <div className="side-col">
      <Suggestions items={suggestions} />
      <section className="trends" aria-labelledby="trends-h">
        <header className="section-head">
          <h2 id="trends-h">Changes this shift</h2>
          <p className="section-meta">Last 24 h against each patient's previous 7 days</p>
        </header>
        {flagged.map((t) => (
          <article key={t.patient_id} className="trend">
            <header className="trend-head">
              <span className="alert-room">{t.room}</span>
              <span className="alert-name">{t.patient_name}</span>
              {t.mode_changes_24h > 0 && <span className="trend-meta">{t.mode_changes_24h} access-mode change{t.mode_changes_24h > 1 ? "s" : ""}</span>}
            </header>
            {t.flags.map((f) => (
              <p key={f.metric} className={`flag flag-${f.severity}`}>
                <strong>{f.severity === "attention" ? "Needs attention" : "Review"}</strong> {f.message}
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
        {stable.length > 0 && (
          <p className="stable">
            No change: {stable.map((t) => `${t.patient_name} (${t.room})`).join(", ")}
          </p>
        )}
        <p className="fineprint">Flags are prompts for clinical review, not diagnoses.</p>
      </section>
      </div>
    </div>
    </>
  );
}
