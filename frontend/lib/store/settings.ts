'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isInputMode } from '@/lib/modes'
import { safeStorage } from './safe-storage'
import type { InputMode, Language } from '@/lib/types'

export type TextSize = 'md' | 'lg' | 'xl' | 'xxl'
export type ButtonSize = 'regular' | 'large' | 'xl'

export interface SettingsState {
  textSize: TextSize
  highContrast: boolean
  reducedMotion: boolean
  preferredMode: InputMode
  spokenPrompts: boolean
  language: Language
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
  language: 'en' as Language,
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
      version: 1,
      // v1 removed the Single-Switch mode and its scan speed: saved settings fall back to Standard.
      migrate: (saved) => {
        const s = { ...(saved as Record<string, unknown>) }
        delete s.scanSpeed
        if (!isInputMode(s.preferredMode)) s.preferredMode = 'standard'
        return s as unknown as SettingsState
      },
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
    },
  ),
)
