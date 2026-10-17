import type { BeliefItem } from '@/lib/types'
import { pct } from '@/lib/services/backend'
import { cn } from '@/lib/utils'

/** Horizontal bars for the engine's top candidate needs. Ported from the old EnginePanel,
 *  restyled with v0's card/token language. */
export function BeliefBars({ items, set }: { items: BeliefItem[]; set?: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Most likely needs">
      {items.map((b) => {
        const inSet = set?.includes(b.need)
        return (
          <li key={b.need} className="grid grid-cols-[minmax(0,1.4fr)_minmax(50px,1fr)_2.8rem] items-center gap-3">
            <span className={cn('truncate text-sm', !inSet && 'text-muted-foreground', b.risk === 'high' && 'font-semibold')}>
              {b.label}
              {b.risk === 'high' && <span className="ml-1.5 text-xs font-semibold text-urgent">high risk</span>}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn('block h-full rounded-full', b.risk === 'high' ? 'bg-urgent' : 'bg-primary')}
                style={{ width: `${Math.max(b.p * 100, 2)}%` }}
              />
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{pct(b.p)}</span>
          </li>
        )
      })}
    </ul>
  )
}
