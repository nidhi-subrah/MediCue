'use client'

import { useCallback } from 'react'
import { SPEECH_LANG, canSpeak, speak, stopSpeaking } from '@/lib/speech'
import { useSettings } from '@/lib/store/settings'
import type { Language } from '@/lib/types'

/** Browser speech (no paid service). `language` follows the patient's explicit choice on the tablet. */
export function useSpeaker(language: string = 'en') {
  const rate = useSettings((s) => s.speechRate)
  const lang = SPEECH_LANG[language as Language] ?? SPEECH_LANG.en

  const say = useCallback(
    (text: string) => speak(text, { lang, rate }),
    [lang, rate],
  )

  return { say, stop: stopSpeaking, supported: canSpeak }
}
