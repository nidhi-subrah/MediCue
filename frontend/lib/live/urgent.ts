'use client'

import { create } from 'zustand'

/** Drives the full-screen UrgentOverlay. Ephemeral (not persisted) — it's a local UI
 *  takeover, not a server concept. Triggered automatically when a session escalates. */
interface UrgentState {
  open: boolean
  message: string | null
  reason: string | null
  /** Whether the nurse station was told: null when nothing was sent (e.g. a staff device). */
  notice: { ok: boolean; text: string } | null
  openUrgent: (message?: string, reason?: string) => void
  setNotice: (notice: { ok: boolean; text: string } | null) => void
  closeUrgent: () => void
}

export const useUrgent = create<UrgentState>((set) => ({
  open: false,
  message: null,
  reason: null,
  notice: null,
  openUrgent: (message, reason) => set({ open: true, message: message ?? null, reason: reason ?? null, notice: null }),
  setNotice: (notice) => set({ notice }),
  closeUrgent: () => set({ open: false, message: null, reason: null, notice: null }),
}))
