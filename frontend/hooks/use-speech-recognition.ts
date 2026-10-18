'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechState = 'idle' | 'listening' | 'error' | 'unsupported'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
}

/** Free, in-browser speech-to-text (the Web Speech API) — no audio ever leaves the device for
 *  transcription. Gemini is only used afterwards, on the resulting text, to match it to the
 *  patient's current step.
 *
 *  `onFinal` fires exactly once per listening session with the recognized text (or null if nothing was
 *  recognized) — whenever it actually ends, whether that's the patient stopping it, the browser
 *  auto-ending after a pause in speech (it does this on its own; "continuous" recognition still ends
 *  itself after a silence), or an error. It does NOT fire after `cancel()`. */
export function useSpeechRecognition(onFinal: (transcript: string | null) => void) {
  const [state, setState] = useState<SpeechState>(() => (getRecognitionCtor() ? 'idle' : 'unsupported'))
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')
  const cancelledRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => () => recognitionRef.current?.abort(), [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setState('unsupported')
      return
    }
    setError(null)
    setInterim('')
    finalRef.current = ''
    cancelledRef.current = false
    const recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      finalRef.current = finalText
      setInterim(interimText || finalText)
    }
    recognition.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return   // resolved via onend
      setState('error')
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? "Couldn't access the microphone. You can still use the buttons."
          : "Didn't catch that. You can still use the buttons.",
      )
    }
    recognition.onend = () => {
      setState('idle')
      if (!cancelledRef.current) onFinalRef.current(finalRef.current.trim() || null)
    }
    recognitionRef.current = recognition
    setState('listening')
    recognition.start()
  }, [])

  /** Ends listening now instead of waiting for the browser to detect a pause; still resolves via onFinal. */
  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  /** Ends listening and discards whatever was heard — onFinal does not fire. */
  const cancel = useCallback(() => {
    cancelledRef.current = true
    recognitionRef.current?.abort()
    setState('idle')
  }, [])

  return { state, interim, error, start, stop, cancel }
}
