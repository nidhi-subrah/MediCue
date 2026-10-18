'use client'

import { useState } from 'react'
import type { ChoiceItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChoiceCard } from './choice-card'

type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number }

/** Regions drawn on the front-facing figure. Everything else in the option list — regions
 *  with no obvious figure location (surgical site, whole body, washroom, people/feelings) —
 *  falls back to a ChoiceCard below, same pattern the figure itself uses for consistency. */
const REGIONS: Record<string, Shape[]> = {
  head: [{ kind: 'circle', cx: 100, cy: 34, r: 24 }],
  chest: [{ kind: 'rect', x: 64, y: 80, w: 72, h: 58, rx: 18 }],
  belly: [{ kind: 'rect', x: 68, y: 142, w: 64, h: 54, rx: 16 }],
  arms_legs: [
    { kind: 'rect', x: 36, y: 84, w: 24, h: 118, rx: 12 },
    { kind: 'rect', x: 140, y: 84, w: 24, h: 118, rx: 12 },
    { kind: 'rect', x: 70, y: 202, w: 28, h: 130, rx: 14 },
    { kind: 'rect', x: 102, y: 202, w: 28, h: 130, rx: 14 },
  ],
}

export function BodyMap({ items }: { items: ChoiceItem[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const onFigure = items.filter((i) => REGIONS[i.id])
  const others = items.filter((i) => !REGIONS[i.id])

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex flex-col items-center gap-3">
        <svg
          viewBox="0 0 200 340"
          className="h-auto w-full max-w-56"
          aria-hidden="true"
          onPointerLeave={() => setHover(null)}
        >
          {onFigure.map((item) => {
            const urgent = item.tone === 'urgent'
            const active = hover === item.id
            const className = cn(
              'cursor-pointer stroke-2 transition-colors',
              urgent
                ? active
                  ? 'fill-urgent stroke-urgent'
                  : 'fill-urgent-soft stroke-urgent/50'
                : active
                  ? 'fill-primary stroke-primary'
                  : 'fill-primary-soft stroke-primary/30',
            )
            const props = { className, onClick: () => item.onSelect(), onPointerEnter: () => setHover(item.id) }
            return REGIONS[item.id].map((shape, i) =>
              shape.kind === 'circle' ? (
                <circle key={`${item.id}-${i}`} cx={shape.cx} cy={shape.cy} r={shape.r} {...props} />
              ) : (
                <rect key={`${item.id}-${i}`} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...props} />
              ),
            )
          })}
        </svg>
        <p className="h-6 text-center text-base font-semibold text-foreground" aria-hidden="true">
          {hover ? onFigure.find((i) => i.id === hover)?.label : 'Tap where it hurts'}
        </p>
      </div>

      {others.length > 0 && (
        <ul className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Other places">
          {others.map((item) => (
            <li key={item.id}>
              <ChoiceCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
