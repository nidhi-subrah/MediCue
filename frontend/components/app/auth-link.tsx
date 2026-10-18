'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from './auth-provider'

/** The front page's sign-in link. Signed-in visitors see "Open MediCue" instead; /login already sends them on
 *  to their own screen, so the destination and the access rules stay the same. */
export function AuthLink({ className, arrow = false }: { className: string; arrow?: boolean }) {
  const { user } = useAuth()
  return (
    <Link href="/login" className={className}>
      {user ? 'Open MediCue' : 'Sign in'}
      {arrow && <ArrowRight className="size-4" aria-hidden="true" />}
    </Link>
  )
}
