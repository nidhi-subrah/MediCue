'use client'

import { FlaskConical, LogOut, Stethoscope, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from './auth-provider'
import { Brand } from './brand'
import { UrgentButton } from './urgent-button'

const NAV = [
  { href: '/home', label: 'Patients', icon: Users, match: ['/home', '/family'] },
  { href: '/nurse', label: 'Nurse station', icon: Stethoscope, match: ['/nurse'] },
  { href: '/research', label: 'Pattern review', icon: FlaskConical, match: ['/research'] },
] as const

export function AppShell({
  children,
  wide = false,
}: {
  children: React.ReactNode
  wide?: boolean
}) {
  const pathname = usePathname()
  const { user, logout } = useAuth()

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
        <div className="flex min-h-16 w-full items-center justify-between gap-3 px-4 md:px-6 lg:gap-6">
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
                        'flex min-h-10 items-center justify-center gap-2 rounded-full px-2 py-1 text-center text-sm font-medium leading-tight transition-colors lg:px-4',
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
          {user && (
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden lg:inline">Log out</span>
            </button>
          )}
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
        <ul className="mx-auto grid max-w-xl grid-cols-4 gap-1 px-3 py-2">
          {NAV.map((item) => {
            const active = item.match.some((m) => pathname.startsWith(m))
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 text-xs font-semibold transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="flex min-h-8 items-center justify-center text-center leading-tight">
                    {item.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
