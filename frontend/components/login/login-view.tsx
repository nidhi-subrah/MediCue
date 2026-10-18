'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Brand } from '@/components/app/brand'
import { useAuth } from '@/components/app/auth-provider'
import { api } from '@/lib/services/backend'

type LoginResponse = { role: 'patient' | 'nurse'; patient_id: string | null }
type DemoAccount = { role: 'patient' | 'nurse'; email: string; password: string }

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
  // Only listed while the built-in demo passwords are in use (backend/app/auth.py: demo_accounts).
  const [demo, setDemo] = useState<DemoAccount[]>([])
  useEffect(() => {
    api.get<DemoAccount[]>('/api/auth/demo-accounts').then(setDemo).catch(() => {})
  }, [])

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
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(700px_400px_at_50%_-100px,oklch(0.93_0.03_262/0.45),transparent_70%)] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="rise flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Brand />
          <h1 className="page-title">Sign in</h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Continue to your bedside tablet or the nurse station.
          </p>
        </div>

        <form onSubmit={onSubmit} className="panel flex flex-col gap-5 p-6 md:p-8">
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="eyebrow">
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
              className="min-h-12 rounded-lg border border-input bg-surface px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="you@medicue.demo"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="eyebrow">
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
              className="min-h-12 rounded-lg border border-input bg-surface px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-gradient-to-b from-[oklch(0.35_0.08_259)] to-primary text-base font-medium text-primary-foreground shadow-[0_6px_14px_-8px_oklch(0.3_0.08_259/0.5),inset_0_1px_0_oklch(1_0_0/0.1)] transition-all hover:-translate-y-px disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {demo.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-input bg-card/60 p-5">
            <p className="text-sm font-semibold text-foreground">Demo accounts (synthetic data)</p>
            <div className="grid gap-2">
              {demo.map((a) => (
                <button key={a.email} type="button" onClick={() => { setEmail(a.email); setPassword(a.password); setError(null) }}
                        className="flex min-w-0 flex-col items-start rounded-2xl border border-border bg-card px-4 py-3 text-left hover:border-primary/40">
                  <span className="text-base font-semibold">Use the {a.role} account</span>
                  <span className="break-words font-mono text-sm text-muted-foreground">{a.email} · password: {a.password}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            Demo accounts — patient: <span className="font-mono">patient@medicue.demo</span>, nurse:{' '}
            <span className="font-mono">nurse@medicue.demo</span>
          </p>
        )}
      </div>
    </div>
  )
}
