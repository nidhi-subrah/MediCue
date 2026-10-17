import type { LucideIcon } from 'lucide-react'

export type { ModeId, RiskLevel, GroupId, Tile, Need, Catalog, Person, Patient, BeliefItem,
  ScoredAction, TraceStep, SessionStatus, SessionState, SBAR, Alert, ConsultRequest,
  TrendFlag, PatientTrend, WsMessage, HypothesisStatus, ResearchActionKind, ResearchActionScore,
  ResearchEvidence, TimelineEntry, ResearchHypothesis, ResearchInquiry, ResearchDigest,
  StaffMember } from '@shared/types'

/** The UI's own notion of "how the person is answering right now" — a superset of the
 *  backend's ModeId (grid/large/scan). `audio` is a client-only bonus with no server concept;
 *  it's sent to the backend as `grid`. */
export type InputMode = 'standard' | 'easy' | 'switch' | 'audio'
export type Language = 'en' | 'es' | 'fr'

/** One selectable thing on screen — a body region, a feeling, a need, a yes/no choice.
 *  Generic so the same ChoiceCard/QuestionStage/ScanningList/BodyMap render any real step. */
export interface ChoiceItem {
  id: string
  label: string
  hint?: string
  icon?: LucideIcon
  tone?: 'default' | 'urgent' | 'unsure' | 'primary' | 'control'
  selected?: boolean
  onSelect: () => void
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
