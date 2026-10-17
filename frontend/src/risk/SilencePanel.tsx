import { useCallback, useEffect, useState } from "react";
import type { Patient, SilenceLadder, SilenceStep } from "@shared/types";
import { api, timeAgo, useChannel } from "../api";
import Icon from "../components/Icon";

const NURSE = "Nurse station";
const STEP = {
  tablet: { icon: "tablet", title: "Tablet check" },
  contact: { icon: "want_someone", title: "Trusted contact" },
  nurse: { icon: "nurse", title: "Nurse" },
} as const;

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function countdown(deadline: string, now: number) {
  const s = Math.max(0, Math.round((new Date(deadline).getTime() - now) / 1000));
  return s === 0 ? "due now" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function who(l: SilenceLadder, kind: SilenceStep["kind"]) {
  if (kind === "tablet") return `${l.patient_name}, on the bedside tablet`;
  if (kind === "contact") return l.contact_name ?? "No trusted contact on file";
  return NURSE;
}

function ackName(l: SilenceLadder, s: SilenceStep) {
  if (s.ack_role === "contact") return l.contact_name ?? s.ack_by;
  if (s.ack_role === "patient") return l.patient_name;
  return s.ack_by;
}

function stepStatus(l: SilenceLadder, s: SilenceStep, now: number) {
  if (s.status === "acknowledged") {
    const what = s.outcome === "concern" ? "Raised a concern" : "Acknowledged";
    return `${what} by ${ackName(l, s)} at ${clock(s.ack_at as string)}${s.ack_role !== s.kind && s.ack_role === "nurse" ? " (nurse)" : ""}`;
  }
  if (s.status === "timed_out") return `No answer by ${clock(s.deadline)}`;
  if (s.kind === "nurse") {
    return `Waiting for a nurse · ${s.reminders ? `reminded ${s.reminders}× · ` : ""}next reminder in ${countdown(s.deadline, now)}`;
  }
  return `Waiting · ${countdown(s.deadline, now)} left`;
}

function LadderCard({ l, now }: { l: SilenceLadder; now: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = l.patient_name.split(" ")[0];
  const order: SilenceStep["kind"][] = l.contact_id ? ["tablet", "contact", "nurse"] : ["tablet", "nurse"];
  const contacted = l.steps.map((s) => who(l, s.kind).split(",")[0]);

  const acknowledge = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/risk/silence/ladders/${l.id}/ack`, { step: l.current, role: "nurse", actor: NURSE });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`ladder ${l.active ? "ladder-active" : "ladder-closed"}`} aria-label={`Inactivity check for ${l.patient_name}`}>
      <header className="alert-head">
        <span className="alert-room">{l.room}</span>
        <span className="alert-name">{l.patient_name}</span>
        <span className="ladder-state" role="status">
          {l.active ? `Now: ${STEP[l.current ?? "tablet"].title}` : `Closed ${clock(l.closed_at as string)}`}
        </span>
        <span className="alert-time">started {timeAgo(l.started_at)}</span>
      </header>
      <p className="ladder-reason">{l.reason}</p>
      <p className="ladder-contacted">Contacted so far: {contacted.join(" · ")}</p>

      <ol className="ladder-steps">
        {order.map((kind) => {
          const s = l.steps.find((x) => x.kind === kind);
          const current = l.active && l.current === kind;
          return (
            <li key={kind} className={`ladder-step ${s ? `step-${s.status}` : "step-pending"} ${current ? "step-current" : ""}`}>
              <Icon name={STEP[kind].icon} size={20} />
              <div>
                <p className="step-title">{STEP[kind].title} <span className="step-who">· {who(l, kind)}</span></p>
                <p className="step-status">
                  {s ? stepStatus(l, s, now) : l.active ? "Next, if there is no answer" : "Not needed"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {l.active && (
        <div className="confirm-row">
          <button className="btn btn-primary" disabled={busy} onClick={acknowledge}>
            <Icon name="check" size={18} />I've checked on {first} in person
          </button>
          <span className="confirm-label">Closes every step. Nothing closes this check automatically.</span>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </article>
  );
}

/** Inactivity checks (silence detection, mode B) and their escalation ladders. */
export default function SilencePanel() {
  const [ladders, setLadders] = useState<SilenceLadder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [pick, setPick] = useState("");
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<SilenceLadder[]>("/api/risk/silence/ladders").then(setLadders).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    load();
    api.get<Patient[]>("/api/patients").then((ps) => { setPatients(ps); setPick(ps[0]?.id ?? ""); }).catch(() => {});
  }, [load]);
  useChannel("nurse", (m) => {
    if (m.type === "silence_check") setLadders((all) => [m.ladder, ...all.filter((x) => x.id !== m.ladder.id)]);
  }, load);

  const active = ladders.filter((l) => l.active).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const closed = ladders.filter((l) => !l.active)
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? "")).slice(0, 3);

  useEffect(() => {   // plain text countdown, once a second; nothing blinks
    if (active.length === 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active.length]);

  const startCheck = async () => {
    setError(null);
    try {
      await api.post("/api/risk/silence/ladders", { patient_id: pick });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="silence" aria-labelledby="silence-h">
      <header className="section-head">
        <h2 id="silence-h">Inactivity checks</h2>
        <p className="section-meta">
          <span className="tag-synthetic">Synthetic demo patients</span> {active.length === 0 ? "None running" : `${active.length} running`}
        </p>
      </header>
      {active.map((l) => <LadderCard key={l.id} l={l} now={now} />)}
      {closed.length > 0 && (
        <details className="ladder-history">
          <summary>Recently closed ({closed.length})</summary>
          {closed.map((l) => <LadderCard key={l.id} l={l} now={now} />)}
        </details>
      )}
      <div className="silence-start">
        <label>
          <span className="confirm-label">Start a check now</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.room} · {p.name}</option>)}
          </select>
        </label>
        <button className="btn" onClick={startCheck} disabled={!pick}>Start</button>
      </div>
      {error && <p className="error small">{error}</p>}
      <p className="fineprint">
        A check starts when a patient has been inactive for longer than usual for this time of day (never in quiet
        hours): tablet, then their trusted contact, then the nurse. It notices missing interaction only; it can't tell why.
      </p>
    </section>
  );
}
