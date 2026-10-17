'use client'

import { create } from 'zustand'
import type { InputMode } from '@/lib/types'

export type SignalKind = 'delay' | 'correction' | 'deletion' | 'miss'
export type Suggestion = 'easy' | null

interface Signal { id: string; kind: SignalKind; at: number; simulated: boolean }

const SIGNAL_THRESHOLD = 3

interface UiAssistState {
  signals: Signal[]
  suggestion: Suggestion
  lastDecisionAt: number
  recordSignal: (kind: SignalKind, mode: InputMode) => void
  resolve: () => void
  clear: () => void
}

/** Notices fumbling (delay, backspacing, missed taps) and offers to switch to a simpler
 *  input mode. Purely a client-side nicety — no server concept, so it lives outside the
 *  live session. */
export const useUiAssist = create<UiAssistState>((set, get) => ({
  signals: [],
  suggestion: null,
  lastDecisionAt: Date.now(),

  recordSignal: (kind, mode) => {
    const signal: Signal = { id: `sig_${Math.random().toString(36).slice(2, 9)}`, kind, at: Date.now(), simulated: false }
    const signals = [...get().signals, signal].slice(-40)
    let suggestion = get().suggestion
    const recent = signals.filter((s) => s.at > get().lastDecisionAt).length
    if (!suggestion && recent >= SIGNAL_THRESHOLD && mode === 'standard') suggestion = 'easy'
    set({ signals, suggestion })
  },

  resolve: () => set({ suggestion: null, lastDecisionAt: Date.now() }),
  clear: () => set({ signals: [], suggestion: null, lastDecisionAt: Date.now() }),
}))
