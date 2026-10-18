// MediCue API contract. The backend's Pydantic/dict responses follow these shapes.
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
  question: { id: string; text: string; text_full: string; text_local: string;   // text: reworded for the mode
              wording: "standard" | "simple" | "binary" } | null;
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
  options: FeelingOptions | null;     // tailored second-step options (backend/app/engine/options.py)
  choice: OptionChoice | null;        // the option the patient picked
  communication: CommunicationState;  // adaptive communication (backend/app/engine/communication)
  can_go_back: boolean;               // "Back" undoes the last input (only while nothing has been sent)
}

/** POST /api/sessions/{sid}/voice response. Never applies anything by itself — "suggested" needs an
 *  explicit follow-up tap/answer with via:"voice" to confirm; "urgent" opens the urgent-help overlay. */
export interface VoiceConfirmAction {
  action: "tap" | "answer";
  kind?: "area" | "feeling";          // action: "tap"
  tap_id?: string;                    // action: "tap"
  option_id?: string;                 // action: "tap", kind: "feeling"
  question_id?: string;               // action: "answer"
  answer?: string;                    // action: "answer"
}

export interface VoiceResult {
  outcome: "empty" | "transcribed" | "suggested" | "partial" | "unclear" | "urgent";
  transcript?: string;
  label?: string;                     // outcome: "suggested" | "partial" - the matched choice's label
  confirm?: VoiceConfirmAction;       // outcome: "suggested" | "partial"
  clarifying_question?: string | null; // outcome: "unclear"
  session: SessionState;
}

export interface SBAR { situation: string; background: string; assessment: string; recommendation: string }

export interface Alert {
  id: string; patient_id: string; patient_name: string; room: string; session_id: string | null;
  kind: "need" | "welfare" | "urgent";   // urgent: the patient pressed Urgent help on their tablet
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
  // Clinician copilot: set shortly after the alert when the episode ended without a confident answer
  // (full packet) or escalated on the safety floor (light packet). Also at GET /api/cases/{alert id}.
  // "Needs help communicating" requests (adaptive communication, assisted mode): what is and isn't known.
  communication?: CommunicationSummary | null;
  case?: CaseRecord | null;
  choice?: OptionChoice | null;       // what the patient picked at the second step
  voice_transcripts?: string[];       // patient's own words (voice), confirmed only - not an AI inference
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

// ---- Tiger Data analytics (Feature #4) -----------------------------------------------------------

/** One candidate action the decision engine scored at a given cycle — not just the one chosen.
 *  See `GET /api/analytics/sessions/{id}/decision-trace`. */
export interface DecisionActionRow {
  time: string; patient_id: string; session_id: string; decision_cycle: string;
  kind: "ask" | "lookup" | "consult" | "escalate" | "send" | "tap";
  action_id: string; label: string;
  eig: number | null; fatigue_cost: number | null; delay_cost: number | null;
  other_costs: Record<string, number>; value: number; score: number; selected: boolean; rank: number;
  origin: "synthetic_history" | "live_demo";
}

export interface BeliefEvolutionPoint { time: string; step: number; need_id: string; label: string; prob: number }

export interface CompressionStat {
  table: string; available: boolean;
  total_chunks?: number; compressed_chunks?: number;
  before_bytes?: number | null; after_bytes?: number | null; compression_ratio?: number | null;
}

export interface HypertableStat { hypertable_name: string; chunk_count: number }

export interface PatientAnalytics {
  patient_id: string;
  response_trends: { days_ago: number; avg_tap_interval: number | null; needs: number }[];
  confirmed_need_trends: { date: string; need: string; group: string; count: number }[];
  speech_interaction_trends: { supported: false; reason: string };
  last_activity: { time: string; kind: string } | null;
  interaction_baseline: { avg_tap_interval: number | null; stddev_tap_interval: number | null; avg_taps: number | null; n: number };
  recent_sessions: { session_id: string; time: string }[];
}

/** `GET /api/analytics/tigerdata` — every field is a real measurement; missing capability
 *  comes back as `unavailable`/`null`, never a fabricated number. */
export interface TigerDataOverview {
  store?: "timescale" | "memory";    // memory = in-process fallback: no hypertables or compression
  counts: { events: number; confirmations: number; belief_snapshots: number; decision_candidates: number };
  latest_event_time: string | null;
  hypertable_count: number; chunk_count: number | null;
  hypertables: HypertableStat[];
  compression: CompressionStat[];
  query_latency_ms: number;
  measured_at: string;
  patient?: PatientAnalytics;
}

export type WsMessage =
  | { type: "alert"; alert: Alert }
  | { type: "alert_updated"; alert: Alert }
  | { type: "session"; session: SessionState }
  | { type: "communication_changed"; patient_id: string; change: CommunicationChange }
  | { type: "consult"; consult: ConsultRequest }
  | { type: "welfare_check"; id: string; patient_id: string; requested_by: string; expires_in: number;
      respond_path?: string }         // silence checks answer on their own endpoint
  | { type: "silence_check"; ladder: SilenceLadder }
  | { type: "case"; case: CaseRecord }
  | { type: "welfare_resolved"; id: string; patient_id: string; outcome: "responded" | "no_response" }
  | { type: "profile"; profile: PatientProfile }
  | { type: "suggestions"; patient_id: string; suggestions: ProfileSuggestion[] }
  | { type: "research_updated" };


// ---- patient profiles, nurse-note suggestions, shift summary ----------------------------------------

export type ProfileKind =
  | "need" | "fatigue" | "person_trust" | "person_available" | "person_preferred" | "access" | "start_level" | "signal" | "note";

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

// ---- clinician copilot: case packet for an ambiguous episode (backend/app/services/case_packet.py) ----
// Every field comes from structured engine data. Probabilities are 0-1.

export type StopReason =
  | "RESOLVED"               // the top need is likely enough to act on
  | "SAFETY_FLOOR"           // a high-risk need was possible, so it escalated without more questions
  | "FATIGUE_HIGH"           // the patient was tiring or answers became inconsistent
  | "INFO_GAIN_BELOW_COST"   // no further question was worth the patient's effort
  | "PATIENT_TIMEOUT"        // the patient stopped responding mid-request
  | "MAX_QUESTIONS"          // the question limit was reached
  | "CONSULT_PENDING";       // a trusted contact was asked and has not answered

export type NextStepCode = "ASK_YES_NO" | "SHOW_PAIN_SCALE" | "ASK_CONTACT" | "RECHECK_LATER" | "WATCH_FOR_GESTURES";

export interface CaseSelection {
  t: string;                          // ISO time of the input
  kind: "tap_area" | "tap_feeling" | "answer";
  text: string;                       // e.g. "Tapped area: Belly" or "Do you need the washroom? → no"
}

export interface CaseNeed { need: string; label: string; p: number; in_set: boolean; risk: RiskLevel }

/** "Less likely given answers": never "ruled out"; the system cannot rule a need out. */
export interface LessLikelyNeed {
  need: string; label: string; from_p: number; to_p: number;
  cause: { kind: "tap" | "answer" | "consult" | "chart"; text: string; t: string };
}

/** A chart field that actually moved a probability during the dialogue. */
export interface ChartChange {
  lookup: string; label: string; value: string | null; flagged: boolean;
  need: string; need_label: string; from_p: number; to_p: number; direction: "up" | "down";
}

export interface CasePacket {
  session_id: string; patient_id: string; created_at: string;
  variant: "full" | "light";          // light: high-risk escalation; less_likely and chart_context left empty
  selections: CaseSelection[];
  top_needs: CaseNeed[];              // top 3, with 90% conformal-set membership
  less_likely: LessLikelyNeed[];
  chart_context: ChartChange[];
  stop_reason: { code: StopReason; text: string };
  uncertainty: { set_size: number; top_p: number; p_high: number; text: string };
  next_step: { code: NextStepCode; text: string; need: string | null };   // fixed whitelist; never treatment
}

/** The nurse's verdict, given with the normal confirmation (POST /api/alerts/{id}/confirm). */
export interface CaseFeedback {
  helpful: boolean | null;
  actual_need: string | null; actual_label: string | null;   // what the patient actually needed
  actual_rank: number | null;         // 1-3 if it was in the packet's top needs, else null
  actual_was_less_likely: boolean;    // it was listed as "less likely given answers"
  by: string; at: string;
}

export interface CaseRecord {
  id: string;                         // = the alert id
  alert_id: string; patient_id: string; session_id: string; created_at: string;
  packet: CasePacket;
  sbar: SBAR; sbar_source: "template" | "gemini";   // recommendation is always packet.next_step
  feedback: CaseFeedback | null;
  // "I've read this and I'm on it" (POST /api/cases/{id}/acknowledge). Does not close the alert.
  acknowledged: { by: string; at: string } | null;
  sbar_template: SBAR;                // always kept, so the template and Gemini versions can be compared
  facts: Record<string, unknown>;     // exactly what Gemini is sent (structured facts only)
  gemini: {
    outcome: "pending" | "disabled" | "gemini" | "no_reply" | "rejected";
    sbar: SBAR | null;                // Gemini's version, only when it passed every check
    problems: string[];               // why it was rejected
  };
}

/** A scripted demo scenario run through the real session service (POST /api/demo/scenarios/{id}). */
export interface DemoScenario { id: string; title: string; patient_id: string; hour: number; description: string }
export interface DemoRun {
  scenario: DemoScenario; session_id: string; alert_id: string | null; status: SessionStatus;
  steps: { text: string; status: SessionStatus; fatigue: number; mode: ModeId }[];
}

// ---- tailored second-step options ------------------------------------------------------------------

export interface FeelingOption {
  id: string; label: string; feeling: string;
  high_risk: boolean;                 // always shown, whatever the ranking
  send_now: boolean;                  // goes to the nurse with no follow-up question
  reason: string | null;              // Gemini's one-line reason, when it ranked the options
}

export interface FeelingOptions {
  area: string; area_label: string; prompt: string;
  predicted: FeelingOption[];         // shown first, most likely first
  more: FeelingOption[];              // behind "Something else": the rest, then "None of these"
  source: "gemini" | "engine";
}

export interface OptionChoice {
  id: string; label: string; predicted: boolean; source: "gemini" | "engine" | null; send_now: boolean;
}

// ---- adaptive communication (backend/app/engine/communication, docs/ADAPTIVE_COMMUNICATION.md) ------

export type CommunicationLevel = 1 | 2 | 3 | 4;   // 1 Standard · 2 Simplified · 3 Yes / No · 4 Assisted
export type CommunicationModeName = "STANDARD" | "SIMPLIFIED" | "BINARY" | "ASSISTED";
export type CommunicationModifier =
  | "large_targets" | "extra_spacing" | "confirm_selections" | "simple_wording" | "audio";
export type AdaptationReason =
  | "SLOW_RESPONSE" | "FREQUENT_CORRECTIONS" | "REPEATED_UNCERTAINTY" | "AUDIO_PREFERENCE"
  | "REPEATED_INTERACTION_FAILURE" | "MISSED_RESPONSE" | "RECOVERED" | "EXPLICIT_REQUEST" | "PROFILE";

/** Layer 1 output: what was measured. */
export interface InteractionSignals {
  response_latency_s: number | null; current_latency_s: number | null; baseline_latency_s: number | null;
  baseline_source: "session" | "personal" | null;
  within_session_baseline_s: number | null; personal_baseline_latency_s: number | null;
  baseline_status: "COLD_START" | "LEARNING" | "PERSONALIZED"; personal_baseline_available: boolean;
  slowdown_ratio: number | null; slow_responses: number; sustained_slowdown: boolean;
  correction_count: number; uncertainty_count: number; inconsistent_count: number;
  missed_response_count: number; failed_input_attempts: number; read_aloud_count: number;
  longest_idle_s: number | null; good_streak: number; responses_in_window: number;
  fatigue_score: number; recent_mode_changes: number;
}

/** Layer 2 output: what the policy decided. */
export interface AdaptationDecision {
  should_adapt: boolean; reason: AdaptationReason | null; severity: number;
  suggested_mode: CommunicationModeName | null; add_modifiers: CommunicationModifier[];
  remove_modifiers: CommunicationModifier[]; requires_patient_confirmation: boolean;
  offer: "audio_first" | "assisted" | null; patient_message: string | null; explanation: string;
}

/** What layer 3 (the tablet) should draw. */
export interface Presentation {
  option_count: number; button_size: "regular" | "large" | "huge"; spacing: "normal" | "extra";
  wording: "standard" | "simple" | "binary"; confirm_selections: boolean; audio: boolean;
}

export interface CommunicationChange {
  id: string; at: string; source: "auto" | "patient" | "nurse" | "profile";
  from: CommunicationLevel; to: CommunicationLevel; from_mode: CommunicationModeName; to_mode: CommunicationModeName;
  from_label: string; to_label: string; reason: AdaptationReason | null; severity: number; explanation: string;
  added: CommunicationModifier[]; removed: CommunicationModifier[]; slowdown_ratio: number | null;
  baseline_status: string; signals: InteractionSignals; decision: AdaptationDecision;
  renderer: { before: Presentation; after: Presentation };
  note: string | null;                // Gemini's one line for nurses, when written
}

export interface CommunicationSummary {
  confirmed: { field: string; value: string }[];
  unresolved: { field: string; value: null | string }[];   // never filled in by the system
  belief: { label: string; p: number }[];
}

export interface CommunicationState {
  mode: CommunicationModeName; level: CommunicationLevel; label: string;
  modifiers: CommunicationModifier[]; audio_enabled: boolean;
  floor: CommunicationLevel; max_options: number;
  levels: Record<CommunicationLevel, string>;
  presentation: Presentation; wording: Presentation["wording"];
  reason: AdaptationReason | null; severity: number; explanation: string | null;
  message: { id: string; text: string } | null;          // "I've simplified the choices."
  offer: { id: string; offer: "audio_first" | "assisted"; message: string;
           choices: ("accept" | "decline" | "get_nurse" | "ask_caregiver" | "keep_trying")[] } | null;
  signals: InteractionSignals; baseline_status: InteractionSignals["baseline_status"];
  options: { area: string[] | null; feeling: string[] | null };   // which choices are on screen
  text: Record<string, string>;       // every on-screen string for this wording level
  summary: CommunicationSummary;
  assist: { help: "nurse" | "caregiver" | "nurse_present" | null; person_name: string | null;
            relation: string | null; status: string | null } | null;
  changes: CommunicationChange[];
}

export interface CommunicationHistoryItem {
  event: string; at: string; session_id: string | null; id?: string;
  from_label?: string; to_label?: string; reason?: string; explanation?: string;
  added?: CommunicationModifier[]; source?: string; note?: string | null;
}

export interface CommunicationPatient {
  patient_id: string; patient_name: string; room: string; session_id: string | null; active: boolean;
  level?: CommunicationLevel; label?: string; mode?: { modifiers: CommunicationModifier[] };
  signals?: InteractionSignals; presentation?: Presentation;
  last_change?: CommunicationChange | null; summary?: CommunicationSummary | null;
  changes: CommunicationHistoryItem[];   // this shift, oldest first
}

// ---- nurse views: Unit insights (past) and Care forecast (ahead) — backend/app/services/nurse_views.py ----

export type GaugeLevel = "green" | "amber" | "red" | "unknown";
export interface UnitPatientRef { patient_id: string; name: string; room: string }
export interface NeedGroupRef { id: string; label: string }

export interface HeatCell { start: string; requests: number; urgent: number }
export interface InsightsGauge extends UnitPatientRef {
  tap_speed: { ratio: number | null; recent_s: number | null; usual_s: number | null; level: GaugeLevel; words: string };
  corrections: { count: number; level: GaugeLevel; words: string };
  quiet: { seconds: number | null; usual_seconds: number | null; level: GaugeLevel; since: string; words: string };
  // Adaptive communication, this week vs the week before (counted from communication_mode_changed events)
  adaptation: { this_week: AdaptationWeek; last_week: AdaptationWeek; level: GaugeLevel; words: string };
}
export interface AdaptationWeek {
  sessions: number; simpler_pct: number | null; binary_pct: number | null;
  assisted: number; read_aloud: number;
}
export interface UnitInsights {
  range: "24h" | "7d" | "14d"; bucket: "1 hour" | "1 day"; since: string; until: string; generated_at: string;
  heatmap: { columns: string[]; max: number; patients: (UnitPatientRef & { cells: HeatCell[]; total: number })[] };
  timeline: { hours: number; since: string; until: string;
              patients: (UnitPatientRef & { items: { time: string; kind: "request" | "urgent" | "consult" | "change"; label: string }[] })[] };
  needs_by_type: { groups: NeedGroupRef[];
                   days: { day: string; counts: Record<string, number>; by_patient: Record<string, Record<string, number>> }[];
                   markers: (UnitPatientRef & { time: string; day: string; label: string; kind: string })[] };
  gauges: InsightsGauge[];
}
export interface InsightsCell extends UnitPatientRef {
  start: string; end: string; items: { time: string; label: string; urgent: boolean; group: string }[];
}

export interface ForecastHour { start: string; by_group: Record<string, number>; expected: number; low: number; high: number }
export interface RiskProjection {
  risk: string; label: string; amber: number; red: number; level: "green" | "amber" | "red"; caption: string;
  history: { start: string; score: number }[];
  ahead: { start: string; score: number; low: number; high: number }[];
}
export interface ForecastPatient extends UnitPatientRef {
  enough_history: boolean; history_days: number;
  lead_in: { start: string; requests: number }[];
  hours: ForecastHour[];
  risk: RiskProjection[];
  why: { need: string; label: string; group: string; expected: number; reason: string; source: "gemini" | "pattern" }[];
  adjustments: { group: string; group_label: string; label: string; multiplier: number; reason: string; evidence: string }[];
  flags: { time: string; risk: string; label: string; level: "amber" | "red"; why: string[] }[];
}
export interface CareForecast {
  generated_at: string; source: "gemini" | "base" | "pending"; hours: string[]; groups: NeedGroupRef[];
  patients: ForecastPatient[];
  unit: { start: string; expected: number }[];
  check: { points: { start: string; expected: number; actual: number }[]; expected_total: number; actual_total: number };
  notice: string;
}

/** Nurse station "Unit right now": each unit patient's current state (GET /api/nurse/board). */
export interface NurseBoardRow extends UnitPatientRef {
  state: "urgent" | "checkin" | "waiting" | "answering" | "consult" | "calm";
  headline: string; since: string | null; open_requests: number;
  screen: string | null;              // the tablet's level when it has been simplified ("Yes / No", ...)
}
