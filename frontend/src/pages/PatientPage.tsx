import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModeId, Patient, SessionState } from "@shared/types";
import { api, useChannel } from "../api";
import { catalog } from "../catalog";
import TileGrid, { type TileOption } from "../components/TileGrid";
import EnginePanel from "../components/EnginePanel";

const SPEECH_LANG: Record<string, string> = {
  en: "en-CA", fr: "fr-CA", es: "es-ES", zh: "zh-CN", pa: "pa-IN", ar: "ar-SA", tl: "fil-PH",
};

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

export default function PatientPage({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [s, setS] = useState<SessionState | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEngine, setShowEngine] = useState(() => load("ss.engine", true));
  const [speak, setSpeak] = useState(() => load("ss.speak", false));
  const [welfare, setWelfare] = useState<Welfare | null>(null);
  const [now, setNow] = useState(Date.now());

  const start = useCallback(async (lang?: string | null, mode: ModeId = "grid") => {
    setError(null);
    try {
      const state = await api.post<SessionState>("/api/sessions", { patient_id: patientId, language: lang ?? undefined, mode });
      setS(state);
      setLanguage(state.language);
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

  const t = (key: string, fallback: string) => s?.ui_text[key] ?? fallback;

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
      case "area": return t("prompt:area", "Where is it?");
      case "feeling": return t("prompt:feeling", "What is it like?");
      case "question": return s.question?.text_local ?? "";
      case "waiting_consult": return t("asking", "Asking someone who knows you…");
      case "escalated": return t("help_coming", "Help is coming. A nurse has your message.");
      case "sent": return t("sent", "Your nurse has your message.");
      default: return "";
    }
  }, [s]);

  useEffect(() => {
    if (!speak || !prompt || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(prompt);
    u.lang = SPEECH_LANG[s?.language ?? "en"] ?? "en-CA";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, [prompt, speak]);

  const options: TileOption[] = useMemo(() => {
    if (!s) return [];
    const feelingTiles = () => catalog.feelings.map((f) => ({
      key: f.id, icon: f.icon, label: t(`feeling:${f.id}`, f.label), sublabel: f.label,
      onSelect: () => act("tap", { kind: "feeling", tap_id: f.id }),
    }));
    if (s.status === "area") {
      return catalog.areas.map((a) => ({
        key: a.id, icon: a.icon, label: t(`area:${a.id}`, a.label), sublabel: a.label,
        onSelect: () => act("tap", { kind: "area", tap_id: a.id }),
      }));
    }
    if (s.status === "feeling") return feelingTiles();
    if (s.status === "escalated" && s.taps === 1) return feelingTiles();  // refine an open alert
    if (s.status === "question" && s.question) {
      const q = s.question.id;
      return [
        { key: "yes", icon: "👍", tone: "yes" as const, label: t("yes", "Yes"), sublabel: "Yes", onSelect: () => act("answer", { question_id: q, answer: "yes" }) },
        { key: "no", icon: "👎", tone: "no" as const, label: t("no", "No"), sublabel: "No", onSelect: () => act("answer", { question_id: q, answer: "no" }) },
        { key: "unsure", icon: "🤷", label: t("unsure", "Not sure"), sublabel: "Not sure", onSelect: () => act("answer", { question_id: q, answer: "unsure" }) },
      ];
    }
    if (s.status === "waiting_consult") {
      return [{ key: "skip", icon: "➡️", label: t("keep_going", "Keep going myself"), onSelect: () => act("skip_consult", {}) }];
    }
    return [{ key: "again", icon: "🔁", label: t("start_over", "Start again"), onSelect: () => start(language, s.mode) }];
  }, [s, act, language, start]);

  if (error && !s) return <div className="patient-shell"><p className="error">{error}</p><a href="#/">Back</a></div>;
  if (!s || !patient) return <div className="patient-shell"><p>Loading…</p></div>;

  const remaining = welfare ? Math.max(0, Math.ceil(welfare.expires_in - (now - welfare.started) / 1000)) : 0;

  return (
    <div className={`patient-shell ${showEngine ? "with-engine" : ""}`}>
      <div className="patient-ui">
        <header className="patient-bar">
          <a href="#/" className="muted small" aria-label="Exit to home">✕</a>
          <span className="patient-name">{patient.name} · {patient.room}</span>
          <label className="small">
            <span className="sr-only">Language</span>
            <select value={language ?? "en"} onChange={(e) => { setLanguage(e.target.value); start(e.target.value, s.mode); }}>
              {catalog.languages.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className="small">
            <span className="sr-only">Access mode</span>
            <select value={s.mode} onChange={(e) => act("mode", { mode: e.target.value })}>
              {catalog.modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button className="btn small" aria-pressed={speak} onClick={() => { setSpeak(!speak); save("ss.speak", !speak); }}>
            🔊 {speak ? "On" : "Off"}
          </button>
          <button className="btn small" aria-pressed={showEngine} onClick={() => { setShowEngine(!showEngine); save("ss.engine", !showEngine); }}>
            {showEngine ? "Hide" : "Show"} engine
          </button>
        </header>

        <h1 className={`patient-prompt status-${s.status}`} aria-live="assertive">{prompt}</h1>
        {s.status === "question" && s.question && s.language !== "en" && (
          <p className="muted center">{s.question.text}</p>
        )}
        {s.status === "waiting_consult" && s.consult && (
          <p className="center">Asking {s.consult.person_name} ({s.consult.relation})…</p>
        )}
        {s.status === "escalated" && s.taps === 1 && <p className="center">{t("tell_more", "You can tell us more:")}</p>}
        {s.mode === "scan" && <p className="muted center small">Switch scanning: press Space, Enter, or tap anywhere on the tiles to choose the highlighted one.</p>}

        <TileGrid options={options} mode={s.mode} label={prompt} />
        {busy && <p className="muted center small" aria-live="polite">…</p>}
        {error && <p className="error small">{error}</p>}
      </div>

      {showEngine && <EnginePanel s={s} />}

      {welfare && (
        <button className="welfare-overlay" onClick={async () => {
          await api.post(`/api/welfare/${welfare.id}/respond`);
          setWelfare(null);
        }}>
          <span className="welfare-title">{t("welfare", "Are you okay? Tap anywhere.")}</span>
          <span>{welfare.requested_by} asked us to check on you.</span>
          <span className="welfare-count">{remaining}s</span>
        </button>
      )}
    </div>
  );
}
