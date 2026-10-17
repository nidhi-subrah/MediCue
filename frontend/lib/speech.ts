import type { Language } from './types'

export const SPEECH_LANG: Record<Language, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
}

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string, opts: { lang?: string; rate?: number } = {}) {
  if (!canSpeak() || !text) return false
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const lang = opts.lang ?? 'en-US'
  utterance.lang = lang
  utterance.rate = opts.rate ?? 1
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)))
  if (voice) utterance.voice = voice
  synth.speak(utterance)
  return true
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
}

let audioCtx: AudioContext | null = null

/** Short attention tone played through Web Audio. Returns a stop function. */
export function startAlertTone() {
  if (typeof window === 'undefined') return () => {}
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return () => {}
  audioCtx = audioCtx ?? new Ctx()
  const ctx = audioCtx
  let stopped = false
  const beep = () => {
    if (stopped) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  }
  beep()
  const timer = window.setInterval(beep, 900)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}
