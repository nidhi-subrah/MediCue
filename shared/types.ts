// SilentSignal API contract. The backend's Pydantic/dict responses follow these shapes.
// Keep this file and backend/app/models.py in sync when changing the API.

export type RiskLevel = "high" | "medium" | "low";
export type GroupId = "pain" | "breathing" | "toileting" | "comfort" | "emotional";
export type ModeId = "grid" | "large" | "scan";

export interface Tile { id: string; label: string; icon: string }

export interface Need {
  id: string; group: GroupId; risk: RiskLevel; prior: number; label: string; question: string;
}

export interface Catalog {
  version: number;
  groups: { id: GroupId; label: string; question: string }[];
  areas: Tile[];
  feelings: Tile[];
  needs: Need[];
  modes: { id: ModeId; label: string; description: string }[];
  languages: { id: string; label: string }[];
}

export interface Person {
  id: string; name: string; relation: string; reliability: number; patient_id: string;
}

export interface Patient {
  id: string; name: string; age: number; room: string; diagnosis: string; language: string;
  days_since_surgery: number | null; notes: string;
  chart: Record<string, { value: string; flag: boolean }>;
  chart_events: { time: string; label: string }[];
  people: Person[];
  signal_reliability: number;
}

export interface BeliefItem { need: string; label: string; p: number; risk: RiskLevel; group: GroupId }

export interface ScoredAction {
  kind: "ask" | "lookup" | "consult" | "escalate" | "send";
  id: string; label: string; score: number; value: number;
  costs: Record<string, number>;
}

export interface TraceStep {
  t: string; kind: string; label: string; detail?: string;
  top: BeliefItem[]; entropy: number; p_high: number;
}

export type SessionStatus =
  | "area" | "feeling" | "question" | "waiting_consult" | "escalated" | "sent" | "cancelled";

export interface SessionState {
  session_id: string; patient_id: string; status: SessionStatus; mode: ModeId; language: string;
  question: { id: string; text: string; text_local: string } | null;
  consult: { id: string; person_name: string; relation: string } | null;
  belief: BeliefItem[];               // sorted, top 6
  prediction_set: string[];           // conformal 90% set (need ids)
  p_high: number; entropy: number; fatigue: number;
  taps: number; questions_asked: number;
  last_decision: { chosen: ScoredAction; ranked: ScoredAction[]; reason: string } | null;
  trace: TraceStep[];
  alert_id: string | null;
  ui_text: Record<string, string>;    // translated tile labels/prompts for the patient's language
  prior_reasons: string[];            // why the prior looks the way it does (time of day, surgery, history)
  inconsistencies: number;            // surprising answers (+1) and "not sure" (+0.5) this session
  baseline_interval: number | null;   // patient's usual seconds between inputs, from history
  profile: ProfileItem[];             // patient profile in effect (backend/app/engine/profile.py)
}

export interface SBAR { situation: string; background: string; assessment: string; recommendation: string }

export interface Alert {
  id: string; patient_id: string; patient_name: string; room: string; session_id: string | null;
  kind: "need" | "welfare";
  priority: "urgent" | "routine";
  created_at: string; status: "open" | "confirmed";
  top: BeliefItem[]; prediction_set: string[]; p_high: number;
  asked: { question: string; answer: string }[];
  lookups: { label: string; value: string; flag: boolean }[];
  consults: { person: string; answer: string }[];
  sbar: SBAR; sbar_source: "template" | "gemini";
  confirmed_need: string | null; seconds_to_alert: number;
  reason: string;                     // the decision engine's explanation for this alert
  profile: ProfileItem[];
  nurse_note: string | null;          // observation written at confirmation
}

export interface ConsultRequest {
  id: string; session_id: string; patient_id: string; patient_name: string;
  person_id: string; question: string; options: { need: string; label: string }[];
  status: "pending" | "answered" | "expired"; created_at: string;
}

export interface TrendFlag {
  patient_id: string; metric: string; label: string; message: string;
  current: number; baseline: number; z: number; severity: "review" | "attention";
}

export interface PatientTrend {
  patient_id: string; patient_name: string; room: string;
  series: Record<string, (number | null)[]>;   // metric -> values, index 0 = 7 days ago, last = last 24 h
  flags: TrendFlag[];
  mode_changes_24h: number;
}

export interface Finding {
  id: string; created_at: string; patient_id: string | null; kind: string;
  title: string; evidence: string; hypothesis: string; hypothesis_source: "template" | "gemini";
  status: "proposed" | "validated" | "rejected" | "needs_more_data";
  reviewer: string | null; note: string | null;
  prior_effect: { patient_id: string; need_ids: string[]; multiplier: number; hours?: number[] } | null;
}

export type WsMessage =
  | { type: "alert"; alert: Alert }
  | { type: "alert_updated"; alert: Alert }
  | { type: "session"; session: SessionState }
  | { type: "consult"; consult: ConsultRequest }
  | { type: "welfare_check"; id: string; patient_id: string; requested_by: string; expires_in: number }
  | { type: "welfare_resolved"; id: string; patient_id: string; outcome: "responded" | "no_response" }
  | { type: "profile"; profile: PatientProfile }
  | { type: "suggestions"; patient_id: string; suggestions: ProfileSuggestion[] };

// ---- patient profiles, nurse-note suggestions, shift summary ----------------------------------------

export type ProfileKind =
  | "need" | "fatigue" | "person_trust" | "person_available" | "person_preferred" | "access" | "signal" | "note";

export interface ProfileItem {
  kind: ProfileKind; target: string; value: string; hours: number[] | null;
  evidence: string;                   // exact quote from the chart notes or the nurse's note
  origin: "notes" | "nurse";
  effect: string;                     // plain-language effect on the engine
}

export interface PatientProfile {
  patient_id: string; source: "gemini" | "none"; items: ProfileItem[];
  dropped: { kind: string; target: string; value: string; evidence: string; reason: string; status: string }[];
  updated_at: string | null; notes: string; extracting: boolean;
}

export interface ProfileSuggestion {
  id: string; created_at: string; patient_id: string; patient_name: string; room: string;
  alert_id: string | null; note: string; nurse: string;
  status: "pending" | "approved" | "rejected" | "duplicate" | "blocked";
  reason: string | null; item: ProfileItem; reviewer: string | null; reviewed_at: string | null;
}

export interface HandoffPatient {
  patient_id: string; name: string; room: string; status: "attention" | "watch" | "stable";
  headline: string; watch_for: string | null;
  requests: number; urgent: number; open_urgent: number;
  confirmed: { label: string; count: number }[];
  tap_seconds: number | null; baseline_seconds: number | null;
  inconsistent_answers: number; mode_changes: number;
  trends: { label: string; message: string; severity: "review" | "attention" }[];
  profile: string[];                  // quotes from the notes behind the patient's profile
}

export interface HandoffSummary {
  generated_at: string; window_hours: number; source: "gemini" | "template";
  patients: HandoffPatient[]; stable: { patient_id: string; name: string; room: string }[];
}
