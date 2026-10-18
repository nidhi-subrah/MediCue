'use client'

import { RotateCcw, Volume2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useSpeaker } from '@/hooks/use-speaker'
import { type ButtonSize, type TextSize, useSettings } from '@/lib/store/settings'
import { cn } from '@/lib/utils'

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-6 last:border-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-semibold">{title}</h3>
        {hint && <p className="text-base leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  id,
  title,
  hint,
  checked,
  onChange,
}: {
  id: string
  title: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-6 last:border-0">
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-base leading-relaxed text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="scale-150" />
    </div>
  )
}

/** A slider that snaps to named levels, with the level names under the track. */
function StepSlider<T extends string>({
  label,
  value,
  levels,
  onChange,
}: {
  label: string
  value: T
  levels: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const index = Math.max(0, levels.findIndex((l) => l.value === value))
  return (
    <div className="flex flex-col gap-2">
      <input
        type="range"
        min={0}
        max={levels.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(levels[Number(e.target.value)].value)}
        aria-label={label}
        aria-valuetext={levels[index].label}
        list={`${label}-levels`}
        className="h-3 w-full cursor-pointer accent-primary"
      />
      <datalist id={`${label}-levels`}>
        {levels.map((l, i) => <option key={l.value} value={i} label={l.label} />)}
      </datalist>
      <div className="grid text-sm text-muted-foreground" style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}>
        {levels.map((l, i) => (
          <button
            key={l.value}
            type="button"
            onClick={() => onChange(l.value)}
            className={cn(
              'rounded-lg py-1',
              i === 0 ? 'text-left' : i === levels.length - 1 ? 'text-right' : 'text-center',
              i === index && 'font-semibold text-foreground',
            )}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The patient's own display and sound settings, opened from the bedside tablet (talk-view). They are saved on
 *  this device only, which is why they live on the tablet and not at the nurse station. `onAudio` also switches
 *  read-aloud for the conversation in progress, so the change is heard straight away. */
export function SettingsPanel({ onAudio }: { onAudio?: (on: boolean) => void }) {
  const s = useSettings()
  const { say } = useSpeaker()

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="see" className="rounded-2xl border border-border bg-card px-6">
        <h2 id="see" className="pt-6 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Seeing
        </h2>
        <Row title="Text size" hint="Preview: the quick brown fox needs a glass of water.">
          <StepSlider<TextSize>
            label="Text size"
            value={s.textSize}
            onChange={(v) => s.update({ textSize: v })}
            levels={[
              { value: 'md', label: 'Standard' },
              { value: 'lg', label: 'Large' },
              { value: 'xl', label: 'Extra large' },
            ]}
          />
        </Row>
        <Row title="Button size" hint="Taller buttons need less precision.">
          <StepSlider<ButtonSize>
            label="Button size"
            value={s.buttonSize}
            onChange={(v) => s.update({ buttonSize: v })}
            levels={[
              { value: 'regular', label: 'Standard' },
              { value: 'large', label: 'Comfortable' },
              { value: 'xl', label: 'Spacious' },
            ]}
          />
        </Row>
        <ToggleRow
          id="contrast"
          title="High contrast"
          hint="Stronger text and borders."
          checked={s.highContrast}
          onChange={(v) => s.update({ highContrast: v })}
        />
        <ToggleRow
          id="motion"
          title="Reduce motion"
          hint="Turns off animations and pulsing."
          checked={s.reducedMotion}
          onChange={(v) => s.update({ reducedMotion: v })}
        />
      </section>

      <section aria-labelledby="hear" className="rounded-2xl border border-border bg-card px-6">
        <h2 id="hear" className="pt-6 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Hearing
        </h2>
        <ToggleRow
          id="spoken"
          title="Read aloud"
          hint="Reads each question and its numbered choices aloud, starting now."
          checked={s.spokenPrompts}
          onChange={(v) => {
            s.update({ spokenPrompts: v })
            onAudio?.(v)
          }}
        />
        <Row title="Speaking speed">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0.6}
              max={1.4}
              step={0.05}
              value={s.speechRate}
              onChange={(e) => s.update({ speechRate: Number(e.target.value) })}
              aria-label="Speaking speed"
              className="h-3 flex-1 accent-primary"
            />
            <button
              type="button"
              onClick={() => say('This is how I will sound.')}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
            >
              <Volume2 className="size-4" aria-hidden="true" /> Test
            </button>
          </div>
        </Row>
      </section>

      <button
        type="button"
        onClick={() => {
          s.resetAll()
          onAudio?.(false)
        }}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
      >
        <RotateCcw className="size-4" aria-hidden="true" /> Reset to defaults
      </button>
    </div>
  )
}
