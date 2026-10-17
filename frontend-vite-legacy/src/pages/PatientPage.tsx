import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModeId, Patient, SessionState } from "@shared/types";
import { api, useChannel } from "../api";
import { catalog } from "../catalog";
import TileGrid, { type TileOption } from "../components/TileGrid";
import BodyMap from "../components/BodyMap";
import EnginePanel from "../components/EnginePanel";
import Icon from "../components/Icon";

function load(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function save(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* storage unavailable */ }
}

interface Welfare { id: string; requested_by: string; expires_in: number; started: number }

const STEPS = ["Where", "What", "Check"];
const STEP_OF: Record<string, number> = { area: 0, feeling: 1, question: 2, waiting_consult: 2 };

export default function PatientPage({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [s, setS] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEngine, setShowEngine] = useState(() => load("ss.engine", false));
  const [speak, setSpeak] = useState(() => load("ss.speak", false));
  const [welfare, setWelfare] = useState<Welfare | null>(null);
  const [now, setNow] = useState(Date.now());

  const start = useCallback(async (mode: ModeId = "grid") => {
    setError(null);
    try {
      setS(await api.post<SessionState>("/api/sessions", { patient_id: patientId, language: "en", mode }));
    } catch (e) {
      setError(String(e));
    }
  }, [patientId]);

  useEffect(() => {
    api.get<Patient>(`/api/patients/${patientId}`).then(setPatient).catch((e) => setError(String(e)));
    start();
  }, [patientId, start]);

  useChannel(`patient:${patientId}`, (m) => {
    if (m.type === "session" && s && m.session.session_id === s.session_id) setS(m.session);
    if (m.type === "welfare_check") setWelfare({ id: m.id, requested_by: m.requested_by, expires_in: m.expires_in, started: Date.now() });
    if (m.type === "welfare_resolved") setWelfare(null);
  });

  useEffect(() => {
    if (!welfare) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [welfare]);

  const act = useCallback(async (path: string, body: unknown) => {
    if (!s || busy) return;
    setBusy(true);
    try {
      setS(await api.post<SessionState>(`/api/sessions/${s.session_id}/${path}`, body));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [s, busy]);

  const prompt = useMemo(() => {
    if (!s) return "";
    switch (s.status) {
      case "area": return "Where is it?";
      case "feeling": return "What is it like?";
      case "question": return s.question?.text ?? "";
      case "waiting_consult": return "Asking someone who knows you…";
      case "escalated": return "Help is coming.";
      case "sent": return "Your nurse has your message.";
      default: return "";
    }
  }, [s]);

  useEffect(() => {
    if (!speak || !prompt || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(prompt);
    u.lang = "en-CA";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, [prompt, speak]);

  const options: TileOption[] = useMemo(() => {
    if (!s) return [];
    const feelingTiles = () => catalog.feelings.map((f) => ({
      key: f.id, label: f.label, onSelect: () => act("tap", { kind: "feeling", tap_id: f.id }),
    }));
    if (s.status === "area") {
      return catalog.areas.map((a) => ({
        key: a.id, label: a.label, onSelect: () => act("tap", { kind: "area", tap_id: a.id }),
      }));
    }
    if (s.status === "feeling") return feelingTiles();
    if (s.status === "escalated" && s.taps === 1) return feelingTiles();  // refine an open alert
    if (s.status === "question" && s.question) {
      const q = s.question.id;
      return [
        { key: "yes", label: "Yes", onSelect: () => act("answer", { question_id: q, answer: "yes" }) },
        { key: "no", label: "No", onSelect: () => act("answer", { question_id: q, answer: "no" }) },
        { key: "unsure", label: "Not sure", onSelect: () => act("answer", { question_id: q, answer: "unsure" }) },
      ];
    }
    if (s.status === "waiting_consult") {
      return [{ key: "skip", icon: "forward", label: "Keep going myself", onSelect: () => act("skip_consult", {}) }];
    }
    return [{ key: "again", label: "Start again", onSelect: () => start(s.mode) }];
  }, [s, act, start]);

  if (error && !s) return <div className="patient-shell"><p className="error">{error}</p><a href="#/">Back</a></div>;
  if (!s || !patient) return <div className="patient-shell"><p className="patient-loading">Loading…</p></div>;

  const remaining = welfare ? Math.max(0, Math.ceil(welfare.expires_in - (now - welfare.started) / 1000)) : 0;
  const step = STEP_OF[s.status];
  const done = s.status === "escalated" || s.status === "sent";
  const scan = s.mode === "scan";

  let body: JSX.Element;
  if (!scan && s.status === "area" && s.mode === "grid") {
    body = <BodyMap options={options} />;
  } else if (!scan && s.status === "question") {
    const [yes, no, unsure] = options;
    body = (
      <div className="answers">
        <button className="answer answer-yes" onClick={yes.onSelect}><Icon name="yes" size={56} />Yes</button>
        <button className="answer answer-no" onClick={no.onSelect}><Icon name="no" size={56} />No</button>
        <button className="answer-unsure" onClick={unsure.onSelect}>Not sure</button>
      </div>
    );
  } else if (!scan && (s.status === "waiting_consult" || s.status === "sent" || s.status === "cancelled"
                      || (s.status === "escalated" && s.taps !== 1))) {
    const [only] = options;
    body = (
      <div className="single-action">
        <button className="btn btn-large" onClick={only.onSelect}><Icon name={only.icon ?? only.key} />{only.label}</button>
      </div>
    );
  } else {
    body = <TileGrid options={options} mode={s.mode} label={prompt} />;
  }

  return (
    <div className={`patient-shell ${showEngine ? "with-engine" : ""}`}>
      <div className="patient-ui">
        <header className="patient-bar">
          <a href="#/" className="icon-link" aria-label="Exit to home"><Icon name="close" size={20} /></a>
          <span className="patient-id">{patient.name}<span className="patient-room">{patient.room}</span></span>
          <label className="bar-control">
            <span className="sr-only">Access mode</span>
            <select value={s.mode} onChange={(e) => act("mode", { mode: e.target.value })}>
              {catalog.modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button className="bar-control toggle" aria-pressed={speak} onClick={() => { setSpeak(!speak); save("ss.speak", !speak); }}>
            <Icon name="sound" size={18} /> Read aloud
          </button>
          <button className="bar-control toggle" aria-pressed={showEngine} onClick={() => { setShowEngine(!showEngine); save("ss.engine", !showEngine); }}>
            Engine
          </button>
        </header>

        {step !== undefined && (
          <ol className="steps" aria-label="Progress">
            {STEPS.map((label, i) => (
              <li key={label} className={i === step ? "current" : i < step ? "past" : ""}
                  aria-current={i === step ? "step" : undefined}>{label}</li>
            ))}
          </ol>
        )}

        <div className={`patient-stage ${done ? `done done-${s.status}` : ""}`}>
          {done && <Icon name={s.status === "escalated" ? "alert" : "check"} size={64} className="done-mark" />}
          <h1 className="patient-prompt" aria-live="assertive">{prompt}</h1>
          {s.status === "escalated" && <p className="patient-note">A nurse has your message and is on the way.</p>}
          {s.status === "waiting_consult" && s.consult && (
            <p className="patient-note">We've asked {s.consult.person_name} ({s.consult.relation}) to help.</p>
          )}
          {s.status === "escalated" && s.taps === 1 && <p className="patient-note">You can tell us more:</p>}
          {scan && <p className="patient-hint">Press Space or Enter, or tap anywhere, to choose the highlighted option.</p>}

          {body}
          {busy && <p className="patient-hint" aria-live="polite">Sending…</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </div>

      {showEngine && <EnginePanel s={s} />}

      {welfare && (
        <button className="welfare-overlay" onClick={async () => {
          await api.post(`/api/welfare/${welfare.id}/respond`);
          setWelfare(null);
        }}>
          <span className="welfare-title">Are you okay? Tap anywhere.</span>
          <span>{welfare.requested_by} asked us to check on you.</span>
          <span className="welfare-count">{remaining}</span>
        </button>
      )}
    </div>
  );
}
