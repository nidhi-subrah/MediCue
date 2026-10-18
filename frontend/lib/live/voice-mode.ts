'use client'

import { create } from 'zustand'

/** Whether the patient has "Speak" (the mic) switched on. Shared so read-aloud can adapt: with the mic on it
 *  reads only the question, since the patient answers out loud instead of waiting through the options.
 *  Ephemeral (not persisted); VoiceInput resets it when it goes away. */
export const useVoiceMode = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: false,
  setOn: (on) => set({ on }),
}))
