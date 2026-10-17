import { Ear, Hand, Keyboard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { InputMode } from './types'

export const MODES: Record<
  InputMode,
  { label: string; short: string; description: string; icon: LucideIcon }
> = {
  standard: {
    label: 'Standard',
    short: 'Standard',
    description: 'Type freely and tap regular-sized choices.',
    icon: Keyboard,
  },
  easy: {
    label: 'Easy Touch',
    short: 'Easy',
    description: 'Bigger buttons, fewer choices at a time.',
    icon: Hand,
  },
  audio: {
    label: 'Audio First',
    short: 'Audio',
    description: 'Questions and choices are read aloud. Use number keys.',
    icon: Ear,
  },
}

export const MODE_ORDER: InputMode[] = ['standard', 'easy', 'audio']

export const isInputMode = (v: unknown): v is InputMode => typeof v === 'string' && v in MODES
