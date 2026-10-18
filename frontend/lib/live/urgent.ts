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
  /** Whether the nurse station was told: null when nothing was sent (e.g. a staff device). */
  notice: { ok: boolean; text: string } | null
  openUrgent: (message?: string, reason?: string, source?: 'button' | 'voice') => void
  setNotice: (notice: { ok: boolean; text: string } | null) => void
  closeUrgent: () => void
}

export const useUrgent = create<UrgentState>((set) => ({
  open: false,
  message: null,
  reason: null,
  source: 'button',
  notice: null,
  openUrgent: (message, reason, source = 'button') =>
    set({ open: true, message: message ?? null, reason: reason ?? null, source, notice: null }),
  setNotice: (notice) => set({ notice }),
  closeUrgent: () => set({ open: false, message: null, reason: null, notice: null }),
}))
