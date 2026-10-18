import type { Language } from './types'

export const SPEECH_LANG: Record<Language, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
}

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// Browsers ship several voices per language; the first one listed is often the most robotic. Prefer the
// neural / "natural" ones (Edge's Microsoft Online voices, Google's, Apple's premium ones) and skip novelty voices.
const PREFERRED = [/natural/i, /neural/i, /online/i, /premium/i, /enhanced/i, /google (us|uk) english/i,
  /\b(aria|jenny|guy|sonia|samantha|ava|allison|zoe|evan|serena|daniel|karen|moira)\b/i, /google/i]
const AVOID = /(fred|albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|kathy|organ|ralph|trinoids|whisper|zarvox|espeak|compact)/i

const voiceCache = new Map<string, SpeechSynthesisVoice>()

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const cached = voiceCache.get(lang)
  if (cached) return cached
  const prefix = lang.slice(0, 2).toLowerCase()
  const candidates = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix) && !AVOID.test(v.name))
  if (!candidates.length) return undefined   // voices load asynchronously: try again next time instead of caching nothing
  const score = (v: SpeechSynthesisVoice) => {
    const i = PREFERRED.findIndex((re) => re.test(v.name))
    return (i === -1 ? 0 : PREFERRED.length - i) * 10 + (v.lang.toLowerCase() === lang.toLowerCase() ? 5 : 0) + (v.localService ? 0 : 1)
  }
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0]
  voiceCache.set(lang, best)
  return best
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', () => voiceCache.clear())
}

/** Written text to spoken text: "1: Head." reads as "1, Head." and "Arms / legs" as "Arms or legs". */
function toSpeech(text: string): string {
  return text
    .replace(/(\d+):\s*/g, '$1, ')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Short sentences: more natural phrasing, and avoids long utterances that some browsers cut off midway. */
function chunks(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [text]).map((s) => s.trim()).filter(Boolean)
}

// Whether read-aloud is speaking right now, so the microphone can stay off while it does (otherwise
// the speakers feed straight back into speech recognition).
let generation = 0   // bumped on every speak()/stop so late events from a cancelled run are ignored
let pending = 0
let speakingNow = false
const speakingListeners = new Set<() => void>()

function setSpeaking(value: boolean) {
  if (speakingNow === value) return
  speakingNow = value
  speakingListeners.forEach((l) => l())
}

export const isSpeaking = () => speakingNow

export function subscribeSpeaking(listener: () => void) {
  speakingListeners.add(listener)
  return () => {
    speakingListeners.delete(listener)
  }
}

export function speak(text: string, opts: { lang?: string; rate?: number } = {}) {
  if (!canSpeak() || !text) return false
  const synth = window.speechSynthesis
  synth.cancel()
  const gen = ++generation
  const lang = opts.lang ?? 'en-US'
  const voice = pickVoice(lang)
  const parts = chunks(toSpeech(text))
  pending = parts.length
  setSpeaking(parts.length > 0)
  const finished = () => {
    if (gen !== generation) return
    pending -= 1
    if (pending <= 0) setSpeaking(false)
  }
  for (const part of parts) {
    const utterance = new SpeechSynthesisUtterance(part)
    utterance.lang = lang
    utterance.rate = opts.rate ?? 0.95
    utterance.pitch = 1
    if (voice) utterance.voice = voice
    utterance.onend = finished
    utterance.onerror = finished
    synth.speak(utterance)
  }
  // Some browsers never fire `end` for certain voices; don't leave the mic off forever.
  window.setTimeout(() => {
    if (gen === generation) {
      pending = 0
      setSpeaking(false)
    }
  }, Math.max(4000, text.length * 120 + 2000))
  return true
}

export function stopSpeaking() {
  generation++
  pending = 0
  setSpeaking(false)
  if (canSpeak()) window.speechSynthesis.cancel()
}

let audioCtx: AudioContext | null = null

/** Attention tone played through Web Audio. Returns a stop function.
 *  `calm`: the single soft beep. `siren`: a harsh two-tone alarm, for when the patient presses Urgent help. */
export function startAlertTone(kind: 'calm' | 'siren' = 'calm') {
  if (typeof window === 'undefined') return () => {}
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return () => {}
  audioCtx = audioCtx ?? new Ctx()
  const ctx = audioCtx
  void ctx.resume?.()   // a context made without a fresh tap can start suspended
  let stopped = false
  let high = false
  const beep = () => {
    if (stopped) return
    const siren = kind === 'siren'
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = siren ? 'sawtooth' : 'sine'
    high = !high
    osc.frequency.value = siren ? (high ? 1000 : 700) : 880   // siren alternates high / low
    const peak = siren ? 0.6 : 0.25
    const length = siren ? 0.28 : 0.35
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + length + 0.05)
  }
  beep()
  const timer = window.setInterval(beep, kind === 'siren' ? 320 : 900)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}
