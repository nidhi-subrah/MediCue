'use client'

import { useState } from 'react'
import type { ChoiceItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChoiceCard } from './choice-card'

type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number }

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

const REGION_LABELS: Record<string, { x: number; y: number }> = {
  head: { x: 100, y: 36 },
  chest: { x: 100, y: 109 },
  belly: { x: 100, y: 169 },
  arms_legs: { x: 100, y: 265 },
}

export function BodyMap({ items }: { items: ChoiceItem[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const onFigure = items.filter((i) => REGIONS[i.id])
  const others = items.filter((i) => !REGIONS[i.id])

  return (
    <div className="grid w-full items-start gap-4 sm:grid-cols-[auto_1fr]">
      {/* Body figure — compact */}
      <div className="relative mx-auto flex w-fit flex-col items-center gap-1 sm:mx-0">
        <div className="pointer-events-none absolute inset-0 -m-4 rounded-full bg-[oklch(0.94_0.03_262_/_0.2)] blur-[30px]" aria-hidden="true" />
        <svg
          viewBox="0 0 200 340"
          className="relative h-auto w-40 sm:w-44"
          aria-hidden="true"
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <filter id="body-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="body-fill-primary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.45 0.14 262)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="oklch(0.35 0.1 262)" stopOpacity="0.12" />
            </linearGradient>
            <linearGradient id="body-fill-primary-active" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.45 0.14 262)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="oklch(0.35 0.1 262)" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="body-fill-urgent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.55 0.18 24)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="oklch(0.45 0.15 24)" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="body-fill-urgent-active" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.55 0.18 24)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="oklch(0.45 0.15 24)" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {/* Soft outer outline so the figure reads as one body */}
          {onFigure.flatMap((item) =>
            REGIONS[item.id].map((shape, i) =>
              shape.kind === 'circle' ? (
                <circle key={`halo-${item.id}-${i}`} cx={shape.cx} cy={shape.cy} r={shape.r + 5} fill="none" stroke="oklch(0.5 0.1 262 / 0.1)" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />
              ) : (
                <rect key={`halo-${item.id}-${i}`} x={shape.x - 5} y={shape.y - 5} width={shape.w + 10} height={shape.h + 10} rx={shape.rx + 5} fill="none" stroke="oklch(0.5 0.1 262 / 0.1)" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />
              ),
            ),
          )}
          {!hover && (
            <g pointerEvents="none" aria-hidden="true">
              <circle className="tap-ring" cx="100" cy="109" r="8" fill="oklch(0.5 0.14 262)" />
              <circle cx="100" cy="109" r="3.5" fill="oklch(0.4 0.12 262)" />
            </g>
          )}
          {onFigure.map((item) => {
            const urgent = item.tone === 'urgent'
            const active = hover === item.id
            const fill = urgent
              ? active ? 'url(#body-fill-urgent-active)' : 'url(#body-fill-urgent)'
              : active ? 'url(#body-fill-primary-active)' : 'url(#body-fill-primary)'
            const stroke = urgent
              ? active ? 'oklch(0.52 0.17 24)' : 'oklch(0.52 0.17 24 / 0.35)'
              : active ? 'oklch(0.35 0.1 262)' : 'oklch(0.35 0.1 262 / 0.25)'
            const props = {
              fill,
              stroke,
              strokeWidth: active ? 2.5 : 1.5,
              className: 'cursor-pointer transition-all duration-200',
              filter: active ? 'url(#body-glow)' : undefined,
              onClick: () => item.onSelect(),
              onPointerEnter: () => setHover(item.id),
            }
            return REGIONS[item.id].map((shape, i) =>
              shape.kind === 'circle' ? (
                <circle key={`${item.id}-${i}`} cx={shape.cx} cy={shape.cy} r={shape.r} {...props} />
              ) : (
                <rect key={`${item.id}-${i}`} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...props} />
              ),
            )
          })}
          {hover && REGION_LABELS[hover] && (
            <text
              x={REGION_LABELS[hover].x}
              y={REGION_LABELS[hover].y}
              textAnchor="middle"
              dominantBaseline="central"
              className="pointer-events-none fill-foreground text-[11px] font-semibold"
            >
              {onFigure.find((i) => i.id === hover)?.label}
            </text>
          )}
        </svg>
        <p className={cn(
          'h-5 text-center text-sm font-medium transition-colors duration-200',
          hover ? 'text-foreground' : 'text-muted-foreground',
        )} aria-hidden="true">
          {hover ? onFigure.find((i) => i.id === hover)?.label : 'Tap where it hurts'}
        </p>
      </div>

      {/* Choice cards beside the figure */}
      {others.length > 0 && (
        <ul className="grid w-full grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2.5 self-center" aria-label="Other places">
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
