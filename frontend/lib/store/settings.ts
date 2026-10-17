'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isInputMode } from '@/lib/modes'
import { safeStorage } from './safe-storage'
import type { InputMode } from '@/lib/types'

export type TextSize = 'md' | 'lg' | 'xl' | 'xxl'
export type ButtonSize = 'regular' | 'large' | 'xl'

export interface SettingsState {
  textSize: TextSize
  highContrast: boolean
  reducedMotion: boolean
  preferredMode: InputMode
  spokenPrompts: boolean
  buttonSize: ButtonSize
  speechRate: number
  onboarded: boolean
  update: (patch: Partial<Omit<SettingsState, 'update' | 'resetAll'>>) => void
  resetAll: () => void
}

const defaults = {
  textSize: 'md' as TextSize,
  highContrast: false,
  reducedMotion: false,
  preferredMode: 'standard' as InputMode,
  spokenPrompts: false,
  buttonSize: 'regular' as ButtonSize,
  speechRate: 0.95,
  onboarded: false,
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      update: (patch) => set(patch),
      resetAll: () => set({ ...defaults, onboarded: true }),
    }),
    {
      name: 'silentsignal-settings',
      version: 2,
      // v1 removed the Single-Switch mode and its scan speed (saved settings fall back to Standard);
      // v2 removed the language setting (the app and its speech are English).
      migrate: (saved) => {
        const s = { ...(saved as Record<string, unknown>) }
        delete s.scanSpeed
        delete s.language
        if (!isInputMode(s.preferredMode)) s.preferredMode = 'standard'
        return s as unknown as SettingsState
      },
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
    },
  ),
)
