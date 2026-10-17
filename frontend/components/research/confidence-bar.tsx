import { pct } from '@/lib/services/backend'

/** Confidence track with the two review thresholds marked — port of HypothesisCard's
 *  Confidence sub-component, restyled with v0's token system instead of bespoke CSS. */
export function ConfidenceBar({ confidence, thresholds }: { confidence: number; thresholds: { support: number; reject: number } }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-lg font-semibold tabular-nums">{pct(confidence)}</span>
        <span className="text-xs text-muted-foreground">
          review at {pct(thresholds.reject)} / {pct(thresholds.support)}
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Confidence ${pct(confidence)}; review below ${pct(thresholds.reject)} or above ${pct(thresholds.support)}`}
      >
        <span className="absolute inset-y-0 left-0 block rounded-full bg-primary" style={{ width: `${confidence * 100}%` }} />
        <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${thresholds.reject * 100}%` }} />
        <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${thresholds.support * 100}%` }} />
      </div>
    </div>
  )
}
