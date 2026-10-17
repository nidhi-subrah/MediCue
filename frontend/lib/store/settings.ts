'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isInputMode } from '@/lib/modes'
import { safeStorage } from './safe-storage'
import type { InputMode } from '@/lib/types'

export type TextSize = 'md' | 'lg' | 'xl'
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
      // The product's old name, kept on purpose: renaming the key would drop everyone's saved accessibility settings.
      name: 'silentsignal-settings',
      version: 3,
      // v1 removed the Single-Switch mode and its scan speed (saved settings fall back to Standard);
      // v2 removed the language setting (the app and its speech are English);
      // v3 dropped the fourth text size: a saved 'xxl' becomes Extra large.
      migrate: (saved) => {
        const s = { ...(saved as Record<string, unknown>) }
        delete s.scanSpeed
        delete s.language
        if (s.textSize === 'xxl') s.textSize = 'xl'
        if (!isInputMode(s.preferredMode)) s.preferredMode = 'standard'
        return s as unknown as SettingsState
      },
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
    },
  ),
)
