import { cn } from '@/lib/utils'

/** The title block every staff page opens with: a small accent bar, a mono eyebrow, the title, an optional
 *  one-line description, and an actions slot that wraps under the title on phones. */
export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('rise flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="flex min-w-0 max-w-3xl flex-col gap-2.5">
        <span className="page-title-bar" aria-hidden="true" />
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="text-base leading-relaxed text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
