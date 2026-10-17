import { ArrowLeft, Ellipsis } from 'lucide-react'
import type { ChoiceItem, FeelingOption, InputMode, ModeId, SessionState, Step } from '@/lib/types'
import { CATALOG_ICONS, catalog } from './catalog'

/** UI input mode -> what the backend understands. `audio` rides on `grid`. */
export function backendMode(mode: InputMode): ModeId {
  return mode === 'easy' ? 'large' : 'grid'
}

/** What the patient sees. Audio is client-only, so it comes from the `spokenPrompts` setting and wins
 *  over the backend's mode (even if the backend moved a tiring patient to larger tiles). The UI has no
 *  scanning mode: a backend `scan` session is shown as Easy Touch. */
export function uiMode(mode: ModeId, audio = false): InputMode {
  if (audio) return 'audio'
  return mode === 'large' || mode === 'scan' ? 'easy' : 'standard'
}

/** Builds the one on-screen step QuestionStage should render for the session's current
 *  status, or null when the status needs its own full-screen treatment (waiting_consult,
 *  escalated, sent, cancelled) rather than a question. */
export function buildStep(
  s: SessionState,
  mode: InputMode,
  onTap: (kind: 'area' | 'feeling', id: string, optionId?: string) => void,
  onAnswer: (answer: 'yes' | 'no' | 'unsure') => void,
  more: { open: boolean; setOpen: (open: boolean) => void } = { open: false, setOpen: () => {} },
): Step | null {
  if (s.status === 'area') {
    return {
      id: 'area',
      kind: mode === 'standard' ? 'body' : 'choice',
      prompt: 'Where is it?',
      options: catalog.areas.map((a) => ({
        id: a.id,
        label: a.label,
        icon: CATALOG_ICONS[a.id],
        onSelect: () => onTap('area', a.id),
      })),
    }
  }

  // Tailored options for the area tapped (backend/app/engine/options.py): the predicted few first, the
  // rest behind "Something else".
  if (s.options && (s.status === 'feeling' || (s.status === 'escalated' && s.taps === 1))) {
    const o = s.options
    const item = (x: FeelingOption): ChoiceItem => ({
      id: x.id,
      label: x.label,
      icon: CATALOG_ICONS[x.feeling],
      tone: x.high_risk ? 'urgent' : undefined,
      onSelect: () => onTap('feeling', x.feeling, x.id),
    })
    if (more.open) {
      return {
        id: `feeling-more-${o.area}`,
        kind: 'choice',
        prompt: o.prompt,
        helper: 'More choices',
        options: [
          ...o.more.map(item),
          { id: '__back', label: 'Back to suggestions', icon: ArrowLeft, tone: 'control', onSelect: () => more.setOpen(false) },
        ],
      }
    }
    return {
      id: `feeling-${o.area}`,
      kind: 'choice',
      prompt: o.prompt,
      helper: s.status === 'escalated' ? 'Help is on the way. You can tell us more:' : undefined,
      options: [
        ...o.predicted.map(item),
        { id: '__more', label: 'Something else', icon: Ellipsis, tone: 'control', onSelect: () => more.setOpen(true) },
      ],
    }
  }

  if (s.status === 'feeling' || (s.status === 'escalated' && s.taps === 1)) {
    return {
      id: 'feeling',
      kind: 'choice',
      prompt: 'What is it like?',
      helper: s.status === 'escalated' ? 'You can tell us more:' : undefined,
      options: catalog.feelings.map((f) => ({
        id: f.id,
        label: f.label,
        icon: CATALOG_ICONS[f.id],
        onSelect: () => onTap('feeling', f.id),
      })),
    }
  }

  if (s.status === 'question' && s.question) {
    return {
      id: `question-${s.question.id}`,
      kind: 'yesno',
      prompt: s.question.text,
      options: [
        { id: 'yes', label: 'Yes', onSelect: () => onAnswer('yes') },
        { id: 'no', label: 'No', onSelect: () => onAnswer('no') },
        { id: 'unsure', label: 'Not sure', tone: 'unsure', onSelect: () => onAnswer('unsure') },
      ],
    }
  }

  return null
}
