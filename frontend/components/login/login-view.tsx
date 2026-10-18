'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Brand } from '@/components/app/brand'
import { useAuth } from '@/components/app/auth-provider'
import { api } from '@/lib/services/backend'

type LoginResponse = { role: 'patient' | 'nurse'; patient_id: string | null }

function homeFor(user: LoginResponse) {
  return user.role === 'nurse' ? '/nurse' : `/talk/${user.patient_id}`
}

export function LoginView() {
  const router = useRouter()
  const { refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await api.post<LoginResponse>('/api/auth/login', { email, password })
      await refresh()
      router.replace(homeFor(user))
    } catch {
      setError('Incorrect email or password.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Brand href="/login" />
          <p className="text-base leading-relaxed text-muted-foreground">
            Sign in to continue to your bedside tablet or the nurse station.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-3xl border-2 border-border bg-card p-6 md:p-8">
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-semibold text-foreground">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 rounded-2xl border border-border bg-surface px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="you@medicure.test"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-sm font-semibold text-foreground">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-2xl border border-border bg-surface px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-2xl border border-urgent/30 bg-urgent-soft px-4 py-3 text-sm text-urgent">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-12 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          Demo accounts — patient: <span className="font-mono">patient@medicure.test</span>, nurse:{' '}
          <span className="font-mono">nurse@medicure.test</span>
        </p>
      </div>
    </div>
  )
}
