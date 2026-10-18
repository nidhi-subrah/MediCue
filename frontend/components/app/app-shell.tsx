'use client'

import { ChartColumn, FlaskConical, LogOut, Stethoscope, TrendingUp, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from './auth-provider'
import { BrandMark } from './brand'

const WORKSPACE = [
  { href: '/home', label: 'Patients', icon: Users, match: ['/home', '/family', '/profile'] },
  { href: '/nurse', label: 'Nurse station', icon: Stethoscope, match: ['/nurse'], exclude: ['/nurse/insights', '/nurse/forecast'] },
  { href: '/research', label: 'Pattern review', icon: FlaskConical, match: ['/research'] },
] as const
const INTELLIGENCE = [
  { href: '/nurse/insights', label: 'Insights', icon: ChartColumn, match: ['/nurse/insights'] },
  { href: '/nurse/forecast', label: 'Forecast', icon: TrendingUp, match: ['/nurse/forecast'] },
] as const
type Item = { href: string; label: string; icon: typeof Users; match: readonly string[]; exclude?: readonly string[] }
export const NAV: readonly Item[] = [...WORKSPACE, ...INTELLIGENCE]

function isActive(item: Item, pathname: string) {
  return item.match.some((m) => pathname.startsWith(m)) && !item.exclude?.some((x) => pathname.startsWith(x))
}

/** Staff chrome: a left rail on tablet and desktop (icons only until lg), a bottom bar on phones.
 *  `wide` is kept for the existing call sites; every staff page now shares one content width. */
export function AppShell({ children }: { children: React.ReactNode; wide?: boolean }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  const group = (title: string, items: readonly Item[]) => (
    <div className="flex flex-col gap-0.5">
      <p className="eyebrow hidden px-3 pb-1.5 lg:block">{title}</p>
      {items.map((item) => {
        const active = isActive(item, pathname)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            className={cn(
              'flex min-h-10 items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium lg:justify-start',
              active
                ? 'bg-primary-soft text-primary shadow-[inset_2px_0_0_var(--pop)]'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden="true" />
            <span className="hidden lg:inline">{item.label}</span>
            <span className="sr-only lg:hidden">{item.label}</span>
          </Link>
        )
      })}
    </div>
  )

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col gap-5 border-r border-border bg-card px-2 py-4 md:flex lg:w-60 lg:px-3">
        <Link href="/" aria-label="MediCue home" className="flex items-center justify-center gap-2.5 px-1 lg:justify-start lg:px-2">
          <BrandMark className="size-8" />
          <span className="hidden text-base font-semibold tracking-tight lg:inline">
            Medi<span className="text-pop">Cue</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto">
          {group('Workspace', WORKSPACE)}
          {group('Intelligence', INTELLIGENCE)}
        </nav>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {user && (
            <button
              type="button"
              onClick={() => logout()}
              className="flex min-h-10 items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:justify-start"
            >
              <LogOut className="size-[18px]" aria-hidden="true" />
              <span className="hidden lg:inline">Log out</span>
              <span className="sr-only lg:hidden">Log out</span>
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones: a slim top bar carries the brand and log out; navigation sits at the bottom. */}
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
          <Link href="/" aria-label="MediCue home" className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="text-base font-semibold tracking-tight">Medi<span className="text-pop">Cue</span></span>
          </Link>
          <div className="flex items-center gap-2">
            {user && (
              <button type="button" onClick={() => logout()} aria-label="Log out"
                      className="inline-flex size-11 items-center justify-center rounded-lg border border-border text-muted-foreground">
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-32 pt-6 md:px-8 md:pb-16 md:pt-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5 gap-1 px-2 py-1.5">
          {NAV.map((item) => {
            const active = isActive(item, pathname)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium leading-tight',
                    active ? 'bg-primary-soft text-primary' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  <span className="text-center">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
