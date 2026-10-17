import type { ProfileItem } from '@/lib/types'

/** Profile items as "effect, with the quote from the notes that justifies it". */
export function ProfileList({ items, empty }: { items: ProfileItem[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i, n) => (
        <li key={n} className="flex flex-col gap-1 border-l-4 border-primary/40 pl-3">
          <span className="text-base font-semibold">{i.effect}</span>
          {i.kind !== 'note' && <q className="text-sm italic text-muted-foreground">{i.evidence}</q>}
          {i.origin === 'nurse' && <span className="text-xs text-muted-foreground">Added from a nurse&apos;s note</span>}
        </li>
      ))}
    </ul>
  )
}
