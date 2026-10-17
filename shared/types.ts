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
  label?: string | null;              // e.g. "Patient stopped responding mid-request"
  confirmed_by?: string | null;
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

// ---- Research agent ------------------------------------------------------------------------------

export type HypothesisStatus =
  | "INVESTIGATING" | "WAITING_FOR_CLINICIAN" | "INCONCLUSIVE"
  | "SUPPORTED_PENDING_REVIEW" | "REJECTED_PENDING_REVIEW"
  | "VALIDATED" | "REJECTED";

export type ResearchActionKind = "CHECK_DATA" | "ASK_CLINICIAN" | "WAIT";

/** One row of the deterministic research decision engine's scoring (not LLM reasoning). */
export interface ResearchActionScore {
  kind: ResearchActionKind; label: string; target: string | null;
  eig: number;                         // expected information gain, bits
  costs: Record<string, number>;       // compute | delay | burden | unchecked_data
  score: number;                       // eig − Σ costs
  detail: Record<string, number | string>;
}

// Early-warning risk engine (app/risk). All risk data is synthetic.
export type RiskFlagLevel = "low" | "watch" | "elevated";
export type RiskKey = "fall" | "dehydration" | "delirium";

export interface RiskContributor {
  signal: string; label: string; value: number | null; baseline: number | null;
  z: number; direction: "up" | "down" | "flat";
  contribution: number;               // log-odds this signal added
  text: string;                       // e.g. "3 vs usual 1"
}

export interface RiskScore {
  time: string; risk: RiskKey; label: string; score: number;
  level: RiskFlagLevel; raw_level: RiskFlagLevel; flag: RiskFlagLevel | null;
  enough_data: boolean; reason: string;
  top: RiskContributor[]; contributors: RiskContributor[];
  missing: { signal: string; label: string }[];
  thresholds: { watch: number; elevated: number };
  spark?: number[];                   // highest score per 6 h over the patient's last 7 days of data
  config_version: string;
}

export interface RiskPatient {
  patient_id: string; name: string; room: string; synthetic: boolean;
  risks: Partial<Record<RiskKey, RiskScore>>;
}

export interface RiskOverview { notice: string; config_version: string; patients: RiskPatient[] }

export interface TimelineCase {
  patient_id: string; name: string; room: string; storyline: string; split: "train" | "test";
  risk: RiskKey; label: string; headline: string; lead_days: number | null; flag_level: RiskFlagLevel | null;
}

export interface Timeline {
  notice: string; patient_id: string; name: string; room: string; storyline: string; split: "train" | "test";
  risk: RiskKey; label: string; headline: string; lead_days: number | null;
  outcome: { time: string; onset: string; outcome: string; description: string };
  flag: { time: string; level: RiskFlagLevel; reason: string } | null;
  flags_before_onset: number;
  thresholds: { watch: number; elevated: number };
  signals: { key: string; label: string; risky: "rise" | "fall" }[];
  series: { time: string; score: number; level: RiskFlagLevel; z: Record<string, number | null> }[];
}

// Silence detection escalation ladder (app/risk/silence.py): tablet check -> trusted contact -> nurse.
export interface SilenceStep {
  kind: "tablet" | "contact" | "nurse"; started_at: string; deadline: string;
  status: "open" | "timed_out" | "acknowledged";
  ack_by: string | null; ack_role: string | null; ack_at: string | null;
  outcome: "ok" | "concern" | null; note: string | null; reminders: number;
}

export interface SilenceLadder {
  id: string; patient_id: string; patient_name: string; room: string;
  contact_id: string | null; contact_name: string | null; alert_id: string | null;
  started_at: string; closed_at: string | null; reason: string; active: boolean;
  current: SilenceStep["kind"] | null; steps: SilenceStep[];
}
export interface ResearchEvidence {
  id: string; t: string; source: "data" | "clinician";
  supports: number; contradicts: number; summary: string; log_lr: number;
  confidence_before: number; confidence_after: number;
  episodes?: { time: string; supports: boolean; label: string }[];
  clinician_id?: string; response?: "agree" | "disagree" | "unsure"; note?: string | null;
}

export interface TimelineEntry {
  t: string; kind: "created" | "action" | "evidence" | "confidence" | "status" | "review" | "note";
  text: string; confidence?: number; score?: number;
}

export interface ResearchHypothesis {
  id: string; created_at: string; updated_at: string;
  statement: string; claim: string;
  observation_text: string | null;     // clinician's original words, preserved verbatim
  origin: "clinician" | "system"; origin_detail: string; origin_id: string | null;
  patient_id: string | null; cohort: string;
  test: Record<string, unknown> | null; discovery: string | null;
  rationale?: string; rationale_source?: "gemini" | "template";
  confidence: number; status: HypothesisStatus;
  thresholds: { support: number; reject: number };
  evidence: ResearchEvidence[]; timeline: TimelineEntry[]; asked: string[];
  last_action: ResearchActionKind | null;
  next_action: { kind: string; label: string } | null;
  decision_trace: { t: string; confidence: number; ranked: ResearchActionScore[]; selected: string; selected_label: string } | null;
  prior_effect: { patient_id: string; need_ids: string[]; multiplier: number; hours?: number[]; after_visit_h?: number } | null;
  reviewer: string | null; note: string | null; reviewed_at: string | null;
}

export interface ResearchInquiry {
  id: string; hypothesis_id: string; clinician_id: string; clinician_name: string; clinician_role: string;
  question: string; reliability: number; status: "pending" | "answered"; created_at: string;
  response: "agree" | "disagree" | "unsure" | null; note: string | null; answered_at: string | null;
}

export interface ResearchDigest {
  text: string; source: "gemini" | "template";
  facts: { changed: number; clinician_gained: number; system_inconclusive: number; pending_review: number;
           waiting_clinician: number; statements: string[] };
}

export interface StaffMember { id: string; name: string; role: string; patients: string[] }

export type WsMessage =
  | { type: "alert"; alert: Alert }
  | { type: "alert_updated"; alert: Alert }
  | { type: "session"; session: SessionState }
  | { type: "consult"; consult: ConsultRequest }
  | { type: "welfare_check"; id: string; patient_id: string; requested_by: string; expires_in: number;
      respond_path?: string }         // silence checks answer on their own endpoint
  | { type: "silence_check"; ladder: SilenceLadder }
  | { type: "welfare_resolved"; id: string; patient_id: string; outcome: "responded" | "no_response" }
  | { type: "profile"; profile: PatientProfile }
  | { type: "suggestions"; patient_id: string; suggestions: ProfileSuggestion[] }
  | { type: "research_updated" };


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

// ---- Per-patient gesture learning (backend/app/engine/personal.py) ---------------------------------

/** A gesture (area + feeling) that has consistently meant one need for this patient. */
export interface LearnedSignal {
  area: string; area_label: string; feeling: string; feeling_label: string;
  need: string; need_label: string;
  count: number; of: number;            // confirmations of this need / all confirmations of this gesture
  usual_need: string; usual_label: string;
  personal: boolean;                    // true when it differs from what the gesture means for most patients
}

export interface PatientLearning {
  patient_id: string; confirmations: number; alpha: number; signals: LearnedSignal[];
}

/** One replayed session in the learning demo (real engine, in memory, nothing stored). */
export interface LearningSession {
  session: number; inputs: number; questions: number; outcome: "send" | "escalate";
  top_need: string; top_label: string; top_p: number; correct: boolean; learned_from: number;
  first_guess: string; first_guess_label: string; first_guess_p: number; p_true_after_gesture: number;
}

export interface LearningDemo {
  patient_id: string; area: string; feeling: string; need: string; need_label: string; high_risk: boolean;
  sessions: LearningSession[];
}
