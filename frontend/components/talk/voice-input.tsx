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
import { cn } from '@/lib/utils'

export function VoiceInput() {
  const { voiceEnabled, voiceTranscript, voiceCorrection, tap, answerQuestion } = useLiveSession()
  const openUrgent = useUrgent((s) => s.openUrgent)
  const setNotice = useUrgent((s) => s.setNotice)
  const speaking = useSpeaking()
  const voiceOn = useVoiceMode((s) => s.on)
  const setVoiceOn = useVoiceMode((s) => s.setOn)
  const voiceOnRef = useRef(false)

  useEffect(() => () => useVoiceMode.getState().setOn(false), [])
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
    if (!transcript) return
    setDraft(transcript)
    setPhase('processing')
    const r = await voiceTranscript(transcript, retryCount)
    if (!r) {
      clearReview()
      return
    }
    if (r.outcome === 'urgent') {
      openUrgent(undefined, `"${r.transcript}"`, 'voice')
      setNotice({ ok: true, text: 'The nurse station has been alerted.' })
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

  useEffect(() => {
    if (speaking && speech.state === 'listening') speech.cancel()
  }, [speaking, speech.state])

  useEffect(() => {
    if (!voiceOn || phase !== 'idle' || speech.state !== 'idle' || speaking) return
    const t = window.setTimeout(() => {
      if (voiceOnRef.current) speech.start()
    }, 600)
    return () => window.clearTimeout(t)
  }, [voiceOn, phase, speech.state, speaking])

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
    <div className="glass flex flex-col gap-3 p-4">
      {!voiceOn ? (
        <button
          type="button"
          onClick={() => turnVoice(true)}
          className="group relative inline-flex h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-full bg-gradient-to-b from-primary to-[oklch(0.28_0.07_259)] px-6 text-lg font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/25 active:scale-[0.97]"
        >
          <Mic className="size-6" aria-hidden="true" />
          Speak instead
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2.5" aria-live="polite">
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              {listening && (
                <>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-urgent/50" />
                  <span className="absolute inline-flex size-[150%] animate-[pulse-soft_2s_ease-in-out_infinite] rounded-full bg-urgent/20" />
                </>
              )}
              <span className={cn('relative inline-flex size-3.5 rounded-full', listening ? 'bg-urgent' : 'bg-muted-foreground/50')} />
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              {listening ? 'Listening…' : speaking ? 'Reading aloud…' : phase === 'idle' ? 'Mic on' : 'Mic paused'}
            </span>
          </span>
          <button
            type="button"
            onClick={stopMic}
            className="patient-btn"
          >
            <MicOff className="size-4" aria-hidden="true" />
            Stop mic
          </button>
        </div>
      )}

      {voiceOn && listening && speech.interim && (
        <p className="text-lg italic leading-relaxed text-muted-foreground">{speech.interim}</p>
      )}

      {speech.state === 'error' && <p className="rounded-lg bg-urgent/5 px-3 py-2 text-base text-urgent">{speech.error}</p>}

      {(phase === 'processing' || phase === 'review') && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">What we heard · saved</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={phase === 'processing'}
              rows={2}
              className="rounded-xl border border-[oklch(0.92_0.008_260_/_0.5)] bg-[oklch(1_0_0_/_0.6)] p-3 text-lg leading-relaxed backdrop-blur-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="(nothing heard)"
            />
          </div>

          {phase === 'processing' && (
            <p className="flex items-center gap-2 text-base text-muted-foreground" aria-live="polite">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
              Thinking…
            </p>
          )}

          {phase === 'review' && result?.outcome === 'partial' && (
            <div className="flex flex-col gap-3">
              <p className="text-lg leading-relaxed">
                It sounds like it might be <span className="font-semibold text-primary">{result.label}</span> — is that right?
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-md shadow-primary/15 hover:bg-primary/90 active:scale-[0.97]"
                >
                  <CircleCheckBig className="size-5" aria-hidden="true" />
                  Yes, that&apos;s right
                </button>
                <button
                  type="button"
                  onClick={editAndRetry}
                  className="patient-btn h-12 rounded-full"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  No, try again
                </button>
                <button
                  type="button"
                  onClick={clearReview}
                  className="patient-btn h-12 rounded-full"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Use buttons
                </button>
              </div>
            </div>
          )}

          {phase === 'review' && result && (result.outcome === 'unclear' || result.outcome === 'transcribed') && (
            <div className="flex flex-col gap-3">
              <p className="text-lg leading-relaxed text-muted-foreground">
                {result.clarifying_question ||
                  "I understood part of that, but I'm not sure what you mean. Try again, or use the buttons."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={editAndRetry}
                  className="patient-btn h-12 rounded-full"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Try again
                </button>
                <button
                  type="button"
                  onClick={clearReview}
                  className="patient-btn h-12 rounded-full"
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
