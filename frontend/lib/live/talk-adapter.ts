import { ArrowLeft, Ellipsis } from 'lucide-react'
import type { ChoiceItem, FeelingOption, InputMode, ModeId, SessionState, Step } from '@/lib/types'
import { CATALOG_ICONS, catalog } from './catalog'

/** UI input mode -> what the backend understands. `audio` rides on `grid`. */
export function backendMode(mode: InputMode): ModeId {
  return mode === 'easy' ? 'large' : 'grid'
}

/** What the patient sees. Audio comes from adaptive communication's `audio` modifier (the patient's own
 *  choice); from Simplified on, the backend switches to `large` (or the profile's `scan`), both shown as
 *  Easy Touch: bigger buttons. */
export function uiMode(mode: ModeId, audio = false): InputMode {
  if (audio) return 'audio'
  return mode === 'large' || mode === 'scan' ? 'easy' : 'standard'
}

/** An on-screen string for the current wording level (backend/app/services/communication.py), else the
 *  catalog original. */
export function say(s: SessionState, key: string, fallback: string): string {
  return s.communication?.text?.[key] ?? fallback
}

/** Builds the one on-screen step QuestionStage should render for the session's current status, or null when the
 *  status needs its own full-screen treatment (waiting_consult, escalated, sent, cancelled).
 *
 *  This is the Interface Renderer's input side (layer 3 of adaptive communication): it only follows the
 *  communication state the backend decided — which choices are on screen (`communication.options`) and in
 *  what words (`communication.text`). Yes / No and Assisted arrive as `question` steps, already chosen by the
 *  backend. Nothing here decides to adapt. */
export function buildStep(
  s: SessionState,
  mode: InputMode,
  onTap: (kind: 'area' | 'feeling', id: string, optionId?: string, confirmMs?: number) => void,
  onAnswer: (answer: 'yes' | 'no' | 'unsure') => void,
  more: { open: boolean; setOpen: (open: boolean) => void } = { open: false, setOpen: () => {} },
): Step | null {
  const shown = s.communication?.options ?? { area: null, feeling: null }
  const back = (label: string): ChoiceItem => ({
    id: '__back', label, icon: ArrowLeft, tone: 'control', onSelect: () => more.setOpen(false),
  })

  if (s.status === 'area') {
    const area = (a: (typeof catalog.areas)[number]): ChoiceItem => ({
      id: a.id,
      label: say(s, `area:${a.id}`, a.label),
      icon: CATALOG_ICONS[a.id],
      tone: a.id === 'chest' && shown.area ? 'urgent' : undefined,
      onSelect: (ms) => onTap('area', a.id, undefined, ms),
    })
    const prompt = say(s, 'where', 'Where is it?')
    // Simplified: only the likeliest areas (chest always kept), the rest behind "Somewhere else".
    if (shown.area && !more.open) {
      return {
        id: 'area-likely',
        kind: 'choice',
        prompt,
        options: [
          ...catalog.areas.filter((a) => shown.area?.includes(a.id)).map(area),
          { id: '__more', label: say(s, 'somewhere_else', 'Somewhere else'), icon: Ellipsis, tone: 'control',
            onSelect: () => more.setOpen(true) },
        ],
      }
    }
    return {
      id: shown.area ? 'area-all' : 'area',
      kind: mode === 'standard' && !shown.area ? 'body' : 'choice',
      prompt,
      options: [...catalog.areas.map(area), ...(shown.area ? [back(say(s, 'back', 'Back'))] : [])],
    }
  }

  // Tailored options for the area tapped (backend/app/engine/options.py): the ones the current mode shows
  // first (up to 4 in Standard, 2 in Simplified, high-risk always), the rest behind "Something else".
  if (s.options && (s.status === 'feeling' || (s.status === 'escalated' && s.taps === 1))) {
    const o = s.options
    const all = [...o.predicted, ...o.more]
    const item = (x: FeelingOption): ChoiceItem => ({
      id: x.id,
      label: say(s, `option:${x.id}`, x.label),
      icon: CATALOG_ICONS[x.feeling],
      tone: x.high_risk ? 'urgent' : undefined,
      onSelect: (ms) => onTap('feeling', x.feeling, x.id, ms),
    })
    const firstIds = shown.feeling ?? o.predicted.map((x) => x.id)
    const first = firstIds.flatMap((id) => all.filter((x) => x.id === id))
    const rest = all.filter((x) => !firstIds.includes(x.id))
    const prompt = say(s, `prompt:${o.area}`, o.prompt)
    const helper = s.status === 'escalated' ? 'Help is on the way. You can tell us more:' : undefined
    if (more.open) {
      return {
        id: `feeling-more-${o.area}`,
        kind: 'choice',
        prompt,
        helper: 'More choices',
        options: [...rest.map(item), back(say(s, 'back', 'Back'))],
      }
    }
    return {
      id: `feeling-${o.area}-${first.length}`,
      kind: 'choice',
      prompt,
      helper,
      options: [
        ...first.map(item),
        ...(rest.length
          ? [{ id: '__more', label: say(s, 'something_else', 'Something else'), icon: Ellipsis, tone: 'control' as const,
               onSelect: () => more.setOpen(true) }]
          : []),
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
      id: `question-${s.question.id}-${s.question.wording}`,
      kind: 'yesno',
      prompt: s.question.text,
      options: [
        { id: 'yes', label: say(s, 'yes', 'Yes'), onSelect: () => onAnswer('yes') },
        { id: 'no', label: say(s, 'no', 'No'), onSelect: () => onAnswer('no') },
        // "Not sure" stays its own answer at every level: it is never read as a "no".
        { id: 'unsure', label: say(s, 'unsure', 'Not sure'), tone: 'unsure', onSelect: () => onAnswer('unsure') },
      ],
    }
  }

  return null
}

// ---- "Show someone": the patient's message in their own words ------------------------------------------

/** How each body area reads at the start of the patient's sentence. */
const AREA_PHRASE: Record<string, string> = {
  head: 'My head', chest: 'My chest', belly: 'My belly', back: 'My back', arms_legs: 'My arms or legs',
  surgical_site: 'Where I had surgery', mouth_throat: 'My mouth or throat', whole_body: 'My whole body',
  toilet: 'I need the washroom', people: 'How I feel',
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** What a person standing at the bedside should read: built only from the patient's own taps (never the
 *  engine's internal steps), plus where their request has got to. */
export function patientMessage(s: SessionState): string {
  const tapOf = (kind: 'area' | 'feeling') =>
    [...s.trace].reverse().find((t) => t.kind === 'tap' && t.label.startsWith(`Tapped ${kind}:`))?.detail
  const area = tapOf('area')
  const feelingId = tapOf('feeling')
  const what = s.choice?.label ?? (feelingId ? catalog.feelings.find((f) => f.id === feelingId)?.label : undefined)

  let text: string
  if (!area) {
    text = "I'm trying to tell you something. Please stay with me."
  } else {
    const phrase = AREA_PHRASE[area] ?? catalog.areas.find((a) => a.id === area)?.label ?? 'Something'
    text = what && area !== 'toilet' ? `${phrase}: ${lowerFirst(what)}.` : `${phrase}.`
  }
  if (s.status === 'escalated') text += ' A nurse is on the way.'
  else if (s.status === 'sent') text += ' My nurse has been told.'
  else if (s.status === 'waiting_consult' && s.consult) text += ` We're asking ${s.consult.person_name}.`
  return text
}
