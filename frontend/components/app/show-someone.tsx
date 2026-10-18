'use client'

import { Volume2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSpeaker } from '@/hooks/use-speaker'

export function ShowSomeone({
  open,
  onOpenChange,
  text,
  eyebrow = 'Please read this',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  text: string
  eyebrow?: string
}) {
  const { say } = useSpeaker()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[oklch(0.93_0.006_260_/_0.5)] bg-[oklch(1_0_0_/_0.7)] px-6 py-4 backdrop-blur-md md:px-10">
          <p className="eyebrow">{eyebrow}</p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="patient-btn min-h-12 rounded-xl"
          >
            <X className="size-5" aria-hidden="true" />
            Close
          </button>
        </div>
        <div className="patient-ambient flex flex-1 items-center overflow-y-auto px-6 py-10 md:px-16">
          <DialogTitle className="sr-only">Message for you</DialogTitle>
          <DialogDescription
            render={<p />}
            className="mx-auto max-w-5xl text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground md:text-6xl md:leading-[1.15]"
          >
            {text}
          </DialogDescription>
        </div>
        <div className="flex justify-center border-t border-[oklch(0.93_0.006_260_/_0.5)] bg-[oklch(1_0_0_/_0.7)] px-6 py-5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => say(text)}
            className="inline-flex min-h-16 items-center gap-3 rounded-2xl bg-gradient-to-b from-primary to-[oklch(0.28_0.07_259)] px-8 text-lg font-semibold text-primary-foreground shadow-lg shadow-primary/15 hover:shadow-xl hover:shadow-primary/20 active:scale-[0.97]"
          >
            <Volume2 className="size-6" aria-hidden="true" />
            Speak aloud
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
