'use client'

import { create } from 'zustand'

/** Drives the full-screen UrgentOverlay. Ephemeral (not persisted) — it's a local UI
 *  takeover, not a server concept. Triggered automatically when a session escalates. */
interface UrgentState {
  open: boolean
  message: string | null
  reason: string | null
  /** How it opened: the Urgent help button, or urgent words heard by the mic. Picks the alert sound. */
  source: 'button' | 'voice'
  openUrgent: (message?: string, reason?: string, source?: 'button' | 'voice') => void
  closeUrgent: () => void
}

export const useUrgent = create<UrgentState>((set) => ({
  open: false,
  message: null,
  reason: null,
  source: 'button',
  openUrgent: (message, reason, source = 'button') =>
    set({ open: true, message: message ?? null, reason: reason ?? null, source }),
  closeUrgent: () => set({ open: false, message: null, reason: null }),
}))
