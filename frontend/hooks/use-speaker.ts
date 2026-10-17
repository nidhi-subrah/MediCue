'use client'

import { useCallback } from 'react'
import { SPEECH_LANG, canSpeak, speak, stopSpeaking } from '@/lib/speech'
import { useSettings } from '@/lib/store/settings'

export function useSpeaker() {
  const rate = useSettings((s) => s.speechRate)

  const say = useCallback(
    (text: string) => speak(text, { lang: SPEECH_LANG.en, rate }),
    [rate],
  )

  return { say, stop: stopSpeaking, supported: canSpeak }
}
