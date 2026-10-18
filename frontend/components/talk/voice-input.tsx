'use client'

import { CircleCheckBig, Loader2, Mic, MicOff, Pencil, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useSpeaking } from '@/hooks/use-speaker'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { useUrgent } from '@/lib/live/urgent'
import { useVoiceMode } from '@/lib/live/voice-mode'
import { useLiveSession } from '@/lib/live/session'
import type { VoiceConfirmAction, VoiceResult } from '@/lib/types'

/** Sticky voice mode: one press turns the mic on and it keeps listening through every step until the
 *  patient stops it (or the request is finished). Speech-to-text runs free in the browser (Web Speech API);
 *  matching the text to the current step is free local matching too. A clear match applies right away (the
 *  same `tap`/`answer` a button press would make) with a quick toast; a "partial" match pauses to ask first,
 *  since that one really is a guess. Silence just keeps listening - it is not submitted as a failed attempt. */
export function VoiceInput() {
  const { voiceEnabled, voiceTranscript, voiceCorrection, tap, answerQuestion } = useLiveSession()
  const openUrgent = useUrgent((s) => s.openUrgent)
  const setNotice = useUrgent((s) => s.setNotice)
  const speaking = useSpeaking()
  const voiceOn = useVoiceMode((s) => s.on)
  const setVoiceOn = useVoiceMode((s) => s.setOn)
  const voiceOnRef = useRef(false)

  useEffect(() => () => useVoiceMode.getState().setOn(false), [])   // voice mode ends with the request
  const [phase, setPhase] = useState<'idle' | 'processing' | 'review'>('idle')
  const [result, setResult] = useState<VoiceResult | null>(null)
  const [draft, setDraft] = useState('')
  const [retryCount, setRetryCount] = useState(0)

  const turnVoice = (on: boolean) => {
    voiceOnRef.current = on
    setVoiceOn(on)
  }

  const applyConfirm = (c: VoiceConfirmAction) => {
    if (c.action === 'tap' && c.tap_id) tap(c.kind === 'feeling' ? 'feeling' : 'area', c.tap_id, c.option_id, 0, 'voice')
    else if (c.action === 'answer' && c.answer) answerQuestion(c.answer as 'yes' | 'no' | 'unsure', 'voice')
  }

  const clearReview = () => {
    setResult(null)
    setDraft('')
    setPhase('idle')
  }

  const speech = useSpeechRecognition(async (transcript) => {
    // Fires whenever recognition ends (the browser ends it itself after a pause in speech).
    if (!transcript) return   // silence: the resume effect below just starts listening again
    setDraft(transcript)
    setPhase('processing')
    const r = await voiceTranscript(transcript, retryCount)
    if (!r) {
      clearReview()
      return
    }
    if (r.outcome === 'urgent') {
      // Opened right here, not from an effect: the backend has already escalated the request, which hides
      // this panel, and an effect inside it would never get to run.
      openUrgent(undefined, `“${r.transcript}”`, 'voice')
      setNotice({ ok: true, text: 'The nurse station has been alerted.' })   // the backend already did that
      clearReview()
      return
    }
    if (r.outcome === 'suggested' && r.confirm) {
      toast.success(`Got it — ${r.label}`)
      applyConfirm(r.confirm)
      setRetryCount(0)
      clearReview()
      return
    }
    setDraft(r.transcript ?? '')
    setResult(r)
    setPhase('review')
    if (r.outcome === 'unclear') setRetryCount((n) => n + 1)
  })

  // The mic must not hear read-aloud (it would transcribe the speakers): drop out while it speaks...
  useEffect(() => {
    if (speaking && speech.state === 'listening') speech.cancel()
  }, [speaking, speech.state])

  // ...and keep listening while voice mode is on: restart after every utterance once nothing is pending and
  // read-aloud has finished (a short pause lets the tail of the speech die away first).
  useEffect(() => {
    if (!voiceOn || phase !== 'idle' || speech.state !== 'idle' || speaking) return
    const t = window.setTimeout(() => {
      if (voiceOnRef.current) speech.start()
    }, 600)
    return () => window.clearTimeout(t)
  }, [voiceOn, phase, speech.state, speaking])

  // A denied/failed mic ends voice mode (the buttons are still there).
  useEffect(() => {
    if (speech.state === 'error') turnVoice(false)
  }, [speech.state])

  if (!voiceEnabled || speech.state === 'unsupported') return null

  const stopMic = () => {
    turnVoice(false)
    speech.cancel()
    clearReview()
    setRetryCount(0)
  }

  const confirm = () => {
    if (result?.confirm) applyConfirm(result.confirm)
    setRetryCount(0)
    clearReview()
  }

  const editAndRetry = () => {
    if (draft.trim() !== (result?.transcript ?? '').trim()) voiceCorrection()
    clearReview()
  }

  const listening = speech.state === 'listening'

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      {!voiceOn ? (
        <button
          type="button"
          onClick={() => turnVoice(true)}
          className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-full bg-primary px-6 text-lg font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Mic className="size-6" aria-hidden="true" />
          Speak instead
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2.5" aria-live="polite">
            <span className="relative flex size-3.5 shrink-0">
              {listening && <span className="absolute inline-flex size-full animate-ping rounded-full bg-urgent opacity-60" />}
              <span className={`relative inline-flex size-3.5 rounded-full ${listening ? 'bg-urgent' : 'bg-muted-foreground'}`} />
            </span>
            <span className="text-base font-semibold text-muted-foreground">
              {listening ? 'Listening…' : speaking ? 'Reading aloud…' : phase === 'idle' ? 'Mic on' : 'Mic paused'}
            </span>
          </span>
          <button
            type="button"
            onClick={stopMic}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-base font-semibold hover:bg-muted"
          >
            <MicOff className="size-4" aria-hidden="true" />
            Stop mic
          </button>
        </div>
      )}

      {voiceOn && listening && speech.interim && (
        <p className="text-lg italic leading-relaxed text-muted-foreground">{speech.interim}</p>
      )}

      {speech.state === 'error' && <p className="text-base text-urgent">{speech.error}</p>}

      {(phase === 'processing' || phase === 'review') && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              What we heard · saved
            </span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={phase === 'processing'}
              rows={2}
              className="rounded-xl border border-border bg-card p-3 text-lg leading-relaxed"
              placeholder="(nothing heard)"
            />
          </div>

          {phase === 'processing' && (
            <p className="flex items-center gap-2 text-base text-muted-foreground" aria-live="polite">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              Thinking…
            </p>
          )}

          {phase === 'review' && result?.outcome === 'partial' && (
            <div className="flex flex-col gap-2">
              <p className="text-lg leading-relaxed">
                It sounds like it might be <span className="font-semibold">{result.label}</span> — is that right?
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={confirm}
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <CircleCheckBig className="size-5" aria-hidden="true" />
                  Yes, that&apos;s right
                </button>
                <button
                  type="button"
                  onClick={editAndRetry}
                  className="inline-flex h-12 items-center gap-2 rounded-full border border-border px-5 text-base font-semibold hover:bg-muted"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  No, try again
                </button>
                <button
                  type="button"
                  onClick={clearReview}
                  className="inline-flex h-12 items-center gap-2 rounded-full border border-border px-5 text-base font-semibold hover:bg-muted"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Use buttons
                </button>
              </div>
            </div>
          )}

          {phase === 'review' && result && (result.outcome === 'unclear' || result.outcome === 'transcribed') && (
            <div className="flex flex-col gap-2">
              <p className="text-lg leading-relaxed text-muted-foreground">
                {result.clarifying_question ||
                  "I understood part of that, but I'm not sure what you mean. Try again, or use the buttons."}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={editAndRetry}
                  className="inline-flex h-12 items-center gap-2 rounded-full border border-border px-5 text-base font-semibold hover:bg-muted"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Try again
                </button>
                <button
                  type="button"
                  onClick={clearReview}
                  className="inline-flex h-12 items-center gap-2 rounded-full border border-border px-5 text-base font-semibold hover:bg-muted"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Use buttons
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
