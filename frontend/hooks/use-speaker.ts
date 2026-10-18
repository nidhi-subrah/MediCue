'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { SPEECH_LANG, canSpeak, isSpeaking, speak, stopSpeaking, subscribeSpeaking } from '@/lib/speech'
import { useSettings } from '@/lib/store/settings'

export function useSpeaker() {
  const rate = useSettings((s) => s.speechRate)

  const say = useCallback(
    (text: string) => speak(text, { lang: SPEECH_LANG.en, rate }),
    [rate],
  )

  return { say, stop: stopSpeaking, supported: canSpeak }
}

/** True while read-aloud is speaking (used to keep the microphone off so it doesn't hear the speakers). */
export function useSpeaking() {
  return useSyncExternalStore(subscribeSpeaking, isSpeaking, () => false)
}
