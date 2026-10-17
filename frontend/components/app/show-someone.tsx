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
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-card p-0 ring-0 sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4 md:px-10">
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex min-h-12 items-center gap-2 rounded-full border border-border px-5 text-base font-semibold hover:bg-muted"
          >
            <X className="size-5" aria-hidden="true" />
            Close
          </button>
        </div>
        <div className="flex flex-1 items-center overflow-y-auto px-6 py-10 md:px-16">
          <DialogTitle className="sr-only">Message for you</DialogTitle>
          <DialogDescription
            render={<p />}
            className="mx-auto max-w-5xl text-balance text-4xl font-bold leading-tight tracking-tight text-foreground md:text-6xl md:leading-[1.15]"
          >
            {text}
          </DialogDescription>
        </div>
        <div className="flex justify-center border-t border-border px-6 py-5">
          <button
            type="button"
            onClick={() => say(text)}
            className="inline-flex min-h-16 items-center gap-3 rounded-full bg-primary px-8 text-lg font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Volume2 className="size-6" aria-hidden="true" />
            Speak aloud
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
