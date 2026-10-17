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
      <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-primary p-6 text-center text-primary-foreground">
        <p className="text-balance font-sans text-5xl font-bold leading-tight md:text-7xl">{shown}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => speak(shown)}
            className="min-h-14 rounded-2xl bg-primary-foreground px-6 text-lg font-semibold text-primary"
          >
            Speak again
          </button>
          <button
            type="button"
            onClick={() => setShown(null)}
            className="min-h-14 rounded-2xl border-2 border-primary-foreground px-6 text-lg font-semibold"
          >
            Back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 bg-background p-6 text-foreground">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">SilentSignal · Simple mode</p>
        <h1 className="text-balance text-3xl font-bold">Tap a phrase to say it out loud</h1>
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
        className="min-h-20 rounded-2xl bg-urgent px-6 text-2xl font-bold text-urgent-foreground"
      >
        Urgent help
      </button>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {PHRASES.map((phrase) => (
          <li key={phrase}>
            <button
              type="button"
              onClick={() => {
                speak(phrase)
                setShown(phrase)
              }}
              className="flex min-h-24 w-full items-center justify-center rounded-2xl border-2 border-border bg-card p-4 text-center text-lg font-semibold text-card-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
            >
              {phrase}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            clearSavedData()
            if (onRetry) onRetry()
            else window.location.assign('/')
          }}
          className="min-h-12 rounded-xl bg-primary px-5 font-semibold text-primary-foreground"
        >
          Reset and try the full app again
        </button>
      </div>
    </main>
  )
}
