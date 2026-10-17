'use client'

import { X } from 'lucide-react'
import { SettingsPanel } from '@/components/settings/settings-view'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/** Full-screen sheet on the bedside tablet: the patient's own text, button, contrast and sound settings. */
export function TabletSettings({ open, onOpenChange, onAudio }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAudio: (on: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-4 md:px-10">
          <div className="flex flex-col">
            <DialogTitle className="text-2xl font-bold">Display and sound</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground">
              Changes apply straight away and are saved on this tablet.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <X className="size-5" aria-hidden="true" />
            Done
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
          <div className="mx-auto max-w-3xl">
            <SettingsPanel onAudio={onAudio} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
