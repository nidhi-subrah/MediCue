'use client'

import { BellRing, BellOff, Phone, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSpeaker } from '@/hooks/use-speaker'
import { useUrgent } from '@/lib/live/urgent'
import { startAlertTone } from '@/lib/speech'

const DEFAULT_URGENT_MESSAGE = 'I need help right now. Please come to me.'

export function UrgentOverlay() {
  const open = useUrgent((s) => s.open)
  const message = useUrgent((s) => s.message)
  const reason = useUrgent((s) => s.reason)
  const source = useUrgent((s) => s.source)
  const notice = useUrgent((s) => s.notice)
  const closeUrgent = useUrgent((s) => s.closeUrgent)
  const { say, stop } = useSpeaker()
  const [toneOn, setToneOn] = useState(false)
  const stopTone = useRef<(() => void) | null>(null)

  const text = message ?? DEFAULT_URGENT_MESSAGE

  useEffect(() => {
    if (!open) return
    say(text)
    if (source === 'voice') {   // urgent words were heard: the soft alert sounds on its own (the button's siren is manual)
      stopTone.current = startAlertTone('calm')
      setToneOn(true)
    }
    return () => {
      stop()
      stopTone.current?.()
      stopTone.current = null
      setToneOn(false)
    }
  }, [open, text, source, say, stop])

  const toggleTone = () => {
    if (toneOn) {
      stopTone.current?.()
      stopTone.current = null
      setToneOn(false)
    } else {
      stopTone.current = startAlertTone(source === 'button' ? 'siren' : 'calm')
      setToneOn(true)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeUrgent()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-urgent p-0 text-urgent-foreground ring-0 sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-6 md:px-10">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-urgent-foreground/85">
            <span className="size-2.5 animate-pulse rounded-full bg-urgent-foreground" aria-hidden="true" />
            {reason ? `Urgent · ${reason}` : 'Urgent help'}
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-6 overflow-y-auto px-6 py-8 md:px-16">
          <DialogTitle className="text-balance text-4xl font-bold leading-tight tracking-tight md:text-7xl md:leading-[1.08]">
            {text}
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-pretty text-lg leading-relaxed text-urgent-foreground/85">
            Show this screen to anyone nearby. MediCue does not contact emergency services
            on its own — use the call button if you need them.
          </DialogDescription>
          {notice && (
            <p role="status" className="max-w-2xl rounded-2xl border-2 border-urgent-foreground/70 px-4 py-3 text-xl font-semibold">
              {notice.text}
            </p>
          )}
        </div>

        <div className="grid gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:grid-cols-2 md:px-16 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => say(text)}
            className="inline-flex min-tap items-center justify-center gap-3 rounded-2xl bg-urgent-foreground px-6 text-lg font-semibold text-urgent"
          >
            <Volume2 className="size-6" aria-hidden="true" />
            Speak again
          </button>
          <button
            type="button"
            onClick={toggleTone}
            aria-pressed={toneOn}
            className="inline-flex min-tap items-center justify-center gap-3 rounded-2xl border-2 border-urgent-foreground/60 px-6 text-lg font-semibold"
          >
            {toneOn ? (
              <BellOff className="size-6" aria-hidden="true" />
            ) : (
              <BellRing className="size-6" aria-hidden="true" />
            )}
            {toneOn ? 'Stop alert sound' : 'Play alert sound'}
          </button>
          <a
            href="tel:911"
            className="inline-flex min-tap items-center justify-center gap-3 rounded-2xl border-2 border-urgent-foreground/60 px-6 text-lg font-semibold"
          >
            <Phone className="size-6" aria-hidden="true" />
            Call emergency services
          </a>
          <button
            type="button"
            onClick={closeUrgent}
            className="inline-flex min-tap items-center justify-center rounded-2xl px-6 text-lg font-semibold underline underline-offset-4"
          >
            {"I'm okay now"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
