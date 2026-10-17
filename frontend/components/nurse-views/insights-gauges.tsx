'use client'

import type { UnitInsights } from '@/lib/types'
import { ChartCard, LevelChip, duration } from './common'

const bad = (l: string) => l === 'red' || l === 'amber'

/** Is communicating getting harder, compared with each patient's own usual? Bullets for those who differ. */
export function InsightsGauges({ data }: { data: UnitInsights }) {
  const flagged = data.gauges.filter((g) => [g.tap_speed.level, g.corrections.level, g.quiet.level].some(bad))
  const others = data.gauges.filter((g) => !flagged.includes(g)).map((g) => g.name)
  const bullets: React.ReactNode[] = flagged.map((g) => {
    const why = [
      bad(g.tap_speed.level) && `${g.tap_speed.words.toLowerCase()} (${g.tap_speed.recent_s}s per tap, usually ${g.tap_speed.usual_s}s)`,
      bad(g.corrections.level) && `fixed ${g.corrections.count} taps or answered “not sure”`,
      bad(g.quiet.level) && `quieter than usual (${duration(g.quiet.seconds)} without tapping)`,
    ].filter(Boolean)
    return <><strong>{g.name}</strong>: {why.join('; ')}</>
  })
  if (others.length) bullets.push(flagged.length ? <>Everyone else: as usual</> : <>Everyone is communicating as usual</>)

  return (
    <ChartCard id="gauges" question="Is communicating getting harder for anyone?" bullets={bullets} chartLabel="See every patient">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="text-sm text-muted-foreground">
            <tr>
              <th scope="col" className="pb-2 font-medium">Patient</th>
              <th scope="col" className="pb-2 font-medium">Tapping speed (24 h)</th>
              <th scope="col" className="pb-2 font-medium">Fixed taps or “not sure” (24 h)</th>
              <th scope="col" className="pb-2 font-medium">Longest quiet stretch today</th>
            </tr>
          </thead>
          <tbody>
            {data.gauges.map((g) => (
              <tr key={g.patient_id} className="border-t border-border align-top">
                <th scope="row" className="py-3 pr-3 font-semibold">
                  {g.name} <span className="block font-mono text-xs font-normal text-muted-foreground">{g.room}</span>
                </th>
                <td className="py-3 pr-3">
                  <LevelChip level={g.tap_speed.level}>{g.tap_speed.words}</LevelChip>
                  {g.tap_speed.recent_s !== null && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {g.tap_speed.recent_s}s per tap{g.tap_speed.usual_s !== null && ` · usually ${g.tap_speed.usual_s}s`}
                    </p>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <LevelChip level={g.corrections.level}>{g.corrections.count} {g.corrections.count === 1 ? 'time' : 'times'}</LevelChip>
                </td>
                <td className="py-3">
                  <LevelChip level={g.quiet.level}>{duration(g.quiet.seconds)}</LevelChip>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {g.quiet.usual_seconds !== null ? `Usually up to ${duration(g.quiet.usual_seconds)}` : 'Not enough history yet'}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  )
}
