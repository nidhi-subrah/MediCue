'use client'

import { Activity, ActivitySquare, FlaskConical, Settings2, Stethoscope, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Brand } from './brand'
import { UrgentButton } from './urgent-button'

const NAV = [
  { href: '/home', label: 'Patients', icon: Users, match: ['/home', '/talk', '/family'] },
  { href: '/nurse', label: 'Nurse station', icon: Stethoscope, match: ['/nurse'] },
  { href: '/research', label: 'Pattern review', icon: FlaskConical, match: ['/research'] },
  { href: '/analytics', label: 'Tiger Data', icon: ActivitySquare, match: ['/analytics'] },
  { href: '/early-warning', label: 'Early warning', icon: Activity, match: ['/early-warning'] },
  { href: '/settings', label: 'Settings', icon: Settings2, match: ['/settings'] },
] as const

export function AppShell({
  children,
  wide = false,
}: {
  children: React.ReactNode
  wide?: boolean
}) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-md">
        {/* Full width; on tablets the nav drops its icons and the wordmark so every label fits on one line. */}
        <div className="flex h-16 w-full items-center justify-between gap-3 px-4 md:px-6 lg:gap-6">
          <Brand compact />
          <nav aria-label="Main" className="hidden min-w-0 flex-1 md:block">
            <ul className="flex w-full items-center gap-1 rounded-full border border-border bg-card p-1">
              {NAV.map((item) => {
                const active = item.match.some((m) => pathname.startsWith(m))
                const Icon = item.icon
                return (
                  <li key={item.href} className="min-w-0 flex-1">
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-2 text-sm font-medium transition-colors lg:px-4',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="hidden size-4 shrink-0 lg:block" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <UrgentButton compact />
        </div>
      </header>

      <main
        id="main"
        className={cn(
          'mx-auto w-full flex-1 px-4 pb-32 pt-6 md:px-6 md:pb-16 md:pt-10',
          wide ? 'max-w-6xl' : 'max-w-5xl',
        )}
      >
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-6 gap-1 px-3 py-2">
          {NAV.map((item) => {
            const active = item.match.some((m) => pathname.startsWith(m))
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
