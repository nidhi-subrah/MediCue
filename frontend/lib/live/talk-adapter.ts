import { ArrowLeft, Ellipsis } from 'lucide-react'
import type { ChoiceItem, FeelingOption, InputMode, ModeId, SessionState, Step } from '@/lib/types'
import { CATALOG_ICONS, catalog } from './catalog'

/** UI input mode -> what the backend understands. `audio` rides on `grid`. */
export function backendMode(mode: InputMode): ModeId {
  return mode === 'easy' ? 'large' : 'grid'
}

/** What the patient sees. Audio is client-only, so it comes from the `spokenPrompts` setting and wins
 *  over the backend's mode. From communication-ladder level 2 the backend switches to `large` (or the
 *  profile's `scan`), both shown as Easy Touch: bigger buttons. */
export function uiMode(mode: ModeId, audio = false): InputMode {
  if (audio) return 'audio'
  return mode === 'large' || mode === 'scan' ? 'easy' : 'standard'
}

/** A label reworded for the current ladder level by Gemini (backend/app/engine/ladder.py), else the original. */
function wording(s: SessionState, key: string, fallback: string): string {
  return s.ladder?.labels?.[key] ?? fallback
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
  const level = s.ladder?.level ?? 1

  if (s.status === 'area') {
    const area = (a: (typeof catalog.areas)[number]): ChoiceItem => ({
      id: a.id,
      label: wording(s, `area:${a.id}`, a.label),
      icon: CATALOG_ICONS[a.id],
      tone: a.id === 'chest' && level >= 2 ? 'urgent' : undefined,
      onSelect: () => onTap('area', a.id),
    })
    // Level 2: only the likeliest areas (chest always kept), the rest behind "Somewhere else".
    const likely = level === 2 ? s.ladder.options?.area : undefined
    if (likely && !more.open) {
      return {
        id: 'area-likely',
        kind: 'choice',
        prompt: 'Where is it?',
        options: [
          ...catalog.areas.filter((a) => likely.includes(a.id)).map(area),
          { id: '__more', label: 'Somewhere else', icon: Ellipsis, tone: 'control', onSelect: () => more.setOpen(true) },
        ],
      }
    }
    return {
      id: likely ? 'area-all' : 'area',
      kind: mode === 'standard' && !likely ? 'body' : 'choice',
      prompt: 'Where is it?',
      options: [
        ...catalog.areas.map(area),
        ...(likely
          ? [{ id: '__back', label: 'Back', icon: ArrowLeft, tone: 'control' as const, onSelect: () => more.setOpen(false) }]
          : []),
      ],
    }
  }

  // Tailored options for the area tapped (backend/app/engine/options.py): the predicted few first, the
  // rest behind "Something else".
  if (s.options && (s.status === 'feeling' || (s.status === 'escalated' && s.taps === 1))) {
    const o = s.options
    const item = (x: FeelingOption): ChoiceItem => ({
      id: x.id,
      label: wording(s, `option:${x.id}`, x.label),
      icon: CATALOG_ICONS[x.feeling],
      tone: x.high_risk ? 'urgent' : undefined,
      onSelect: () => onTap('feeling', x.feeling, x.id),
    })
    const prompt = wording(s, `prompt:${o.area}`, o.prompt)
    const helper = s.status === 'escalated' ? 'Help is on the way. You can tell us more:' : undefined
    // Level 1 (Full): every option for the area at once, most likely first.
    if (level === 1) {
      return {
        id: `feeling-all-${o.area}`,
        kind: 'choice',
        prompt,
        helper,
        options: [...o.predicted, ...o.more].map(item),
      }
    }
    // Level 2 (Simplified): the predicted 3-4, the rest behind "Something else".
    if (more.open) {
      return {
        id: `feeling-more-${o.area}`,
        kind: 'choice',
        prompt,
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
      prompt,
      helper,
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
