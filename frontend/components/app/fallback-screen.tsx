'use client'

import { useState } from 'react'
import { clearSavedData } from '@/lib/store/safe-storage'

const PHRASES = [
  'I need help',
  'I am in pain',
  'I need water',
  'I need the bathroom',
  'Yes',
  'No',
  'Please wait',
  'Please call someone',
]

function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  } catch {}
}

export function FallbackScreen({ onRetry }: { onRetry?: () => void }) {
  const [shown, setShown] = useState<string | null>(null)

  if (shown) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-gradient-to-b from-primary to-[oklch(0.25_0.065_259)] p-6 text-center text-primary-foreground">
        <p className="text-balance font-sans text-5xl font-semibold leading-tight md:text-7xl">{shown}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => speak(shown)}
            className="min-h-14 rounded-2xl bg-primary-foreground px-6 text-lg font-semibold text-primary shadow-lg shadow-black/10 transition-all hover:shadow-xl active:scale-[0.97]"
          >
            Speak again
          </button>
          <button
            type="button"
            onClick={() => setShown(null)}
            className="min-h-14 rounded-2xl border border-primary-foreground/50 px-6 text-lg font-semibold backdrop-blur-sm transition-all hover:bg-primary-foreground/10 active:scale-[0.97]"
          >
            Back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      className="patient-ambient relative mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 overflow-hidden p-6 text-foreground"
      style={{
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1.5rem))',
      }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-32 right-[10%] size-[350px] rounded-full bg-[oklch(0.94_0.03_262_/_0.2)] blur-[80px]" />
      </div>
      <header className="relative flex flex-col gap-2">
        <p className="eyebrow">MediCue · Simple mode</p>
        <h1 className="text-balance text-3xl font-semibold">Tap a phrase to say it out loud</h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          The full app could not load, so this simple board is ready instead. Every phrase is spoken and shown large.
        </p>
      </header>

      <button
        type="button"
        onClick={() => {
          speak('I need help right now. Please come to me.')
          setShown('I need help right now. Please come to me.')
        }}
        className="relative min-h-20 overflow-hidden rounded-2xl bg-urgent px-6 text-2xl font-semibold text-urgent-foreground shadow-lg shadow-urgent/20 transition-all hover:shadow-xl hover:shadow-urgent/25 active:scale-[0.98]"
      >
        Urgent help
      </button>

      <ul className="relative grid grid-cols-2 gap-3 md:grid-cols-4">
        {PHRASES.map((phrase) => (
          <li key={phrase}>
            <button
              type="button"
              onClick={() => {
                speak(phrase)
                setShown(phrase)
              }}
              className="flex min-h-24 w-full items-center justify-center rounded-2xl border border-[oklch(0.92_0.008_260_/_0.5)] bg-[oklch(1_0_0_/_0.72)] p-4 text-center text-lg font-semibold text-card-foreground shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring active:scale-[0.97]"
            >
              {phrase}
            </button>
          </li>
        ))}
      </ul>

      <div className="relative flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            clearSavedData()
            if (onRetry) onRetry()
            else window.location.assign('/')
          }}
          className="min-h-12 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-md shadow-primary/15 transition-all hover:shadow-lg hover:shadow-primary/20 active:scale-[0.97]"
        >
          Reset and try the full app again
        </button>
      </div>
    </main>
  )
}
