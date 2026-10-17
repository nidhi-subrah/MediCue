'use client'

import { Hand, ScanLine } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useUiAssist } from '@/lib/live/ui-assist'
import type { InputMode } from '@/lib/types'

export function SuggestionBanner({ onAccept }: { onAccept: (mode: InputMode) => void }) {
  const suggestion = useUiAssist((s) => s.suggestion)
  const resolve = useUiAssist((s) => s.resolve)

  const copy =
    suggestion === 'easy'
      ? {
          icon: Hand,
          title: 'Would larger buttons make this easier?',
          body: 'Easy Touch shows bigger buttons and fewer choices. Everything confirmed so far stays.',
          accept: 'Switch to Easy Touch',
        }
      : {
          icon: ScanLine,
          title: 'Would it help if choices lit up one at a time?',
          body: 'With Single-Switch, press Space, Enter, or one big button when the right choice is lit.',
          accept: 'Switch to Single-Switch',
        }

  return (
    <div aria-live="polite">
      <AnimatePresence>
        {suggestion && (
          <motion.section
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
            aria-label="Suggestion"
          >
            <div className="mb-4 flex flex-col gap-4 rounded-2xl border-2 border-primary/30 bg-primary-soft p-5 md:flex-row md:items-center">
              <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <copy.icon className="size-6" aria-hidden="true" />
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <h2 className="text-xl font-bold text-balance">{copy.title}</h2>
                <p className="leading-relaxed text-muted-foreground">{copy.body}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    resolve()
                    onAccept(suggestion as InputMode)
                  }}
                  className="min-tap rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  {copy.accept}
                </button>
                <button
                  type="button"
                  onClick={resolve}
                  className="min-tap rounded-xl border border-border bg-card px-5 text-base font-semibold hover:bg-muted"
                >
                  Keep current mode
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
