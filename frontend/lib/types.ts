import type { LucideIcon } from 'lucide-react'

export type { ModeId, RiskLevel, GroupId, Tile, Need, Catalog, Person, Patient, BeliefItem,
  ScoredAction, TraceStep, SessionStatus, SessionState, SBAR, Alert, ConsultRequest,
  TrendFlag, PatientTrend, WsMessage, HypothesisStatus, ResearchActionKind, ResearchActionScore,
  ResearchEvidence, TimelineEntry, ResearchHypothesis, ResearchInquiry, ResearchDigest,
  StaffMember, RiskFlagLevel, RiskKey, RiskContributor, RiskScore, RiskPatient, RiskOverview,
  TimelineCase, Timeline, SilenceStep, SilenceLadder, ProfileItem, PatientProfile, ProfileSuggestion,
  HandoffPatient, HandoffSummary, LearnedSignal, PatientLearning, LearningSession, LearningDemo,
  CasePacket, StopReason, NextStepCode, CaseFeedback, CaseRecord, DecisionActionRow,
  BeliefEvolutionPoint, CompressionStat, HypertableStat, PatientAnalytics, TigerDataOverview,
  FeelingOption, FeelingOptions, OptionChoice, DemoScenario, DemoRun, CommunicationLevel, CommunicationState, CommunicationChange, CommunicationPatient,
  CommunicationHistoryItem, CommunicationSummary, Presentation, InteractionSignals, AdaptationDecision,
  CommunicationModifier,
  GaugeLevel, UnitPatientRef, NeedGroupRef, HeatCell, InsightsGauge, UnitInsights, InsightsCell,
  ForecastHour, RiskProjection, ForecastPatient, CareForecast, NurseBoardRow } from '@shared/types'

/** The UI's own notion of "how the person is answering right now". `standard` and `easy` map to
 *  the backend's grid / large; `audio` is client-only (the `spokenPrompts` setting) and is sent to
 *  the backend as `grid`. A backend `scan` session is shown as `easy`. */
export type InputMode = 'standard' | 'easy' | 'audio'
export type Language = 'en' | 'es' | 'fr'

/** One selectable thing on screen — a body region, a feeling, a need, a yes/no choice.
 *  Generic so the same ChoiceCard/QuestionStage/BodyMap render any real step. */
export interface ChoiceItem {
  id: string
  label: string
  hint?: string
  icon?: LucideIcon
  tone?: 'default' | 'urgent' | 'unsure' | 'primary' | 'control'
  selected?: boolean
  /** confirmMs: time spent confirming this choice ("Is that right?"), when a confirmation was shown. */
  onSelect: (confirmMs?: number) => void
}

export type StepKind = 'body' | 'choice' | 'yesno' | 'single'

/** One screen of the live conversation, built from the real session by lib/live/talk-adapter. */
export interface Step {
  id: string
  kind: StepKind
  prompt: string
  helper?: string
  options: ChoiceItem[]
}
