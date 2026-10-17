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
  | { type: "consult"; consult: ConsultRequest }
  | { type: "welfare_check"; id: string; patient_id: string; requested_by: string; expires_in: number }
  | { type: "welfare_resolved"; id: string; patient_id: string; outcome: "responded" | "no_response" }
  | { type: "research_updated" };
