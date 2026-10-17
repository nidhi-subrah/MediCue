'use client'

import { create } from 'zustand'

/** Drives the full-screen UrgentOverlay. Ephemeral (not persisted) — it's a local UI
 *  takeover, not a server concept. Triggered automatically when a session escalates. */
interface UrgentState {
  open: boolean
  message: string | null
  reason: string | null
  openUrgent: (message?: string, reason?: string) => void
  closeUrgent: () => void
}

export const useUrgent = create<UrgentState>((set) => ({
  open: false,
  message: null,
  reason: null,
  openUrgent: (message, reason) => set({ open: true, message: message ?? null, reason: reason ?? null }),
  closeUrgent: () => set({ open: false, message: null, reason: null }),
}))
