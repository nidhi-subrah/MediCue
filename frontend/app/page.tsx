import { ArrowRight, Brain, ChartColumn, Mic, ShieldCheck, Sparkles, Stethoscope, Tablet } from 'lucide-react'
import Link from 'next/link'
import { AuthLink } from '@/components/app/auth-link'
import { BrandMark } from '@/components/app/brand'

export const metadata = {
  title: 'MediCue — A voice for every patient',
  description:
    'MediCue turns a few taps from a patient who cannot speak into a clear clinical message, and says how certain it is.',
}

const STEPS = [
  { icon: Tablet, title: 'The patient taps', body: 'A few large choices on the bedside tablet. Speaking or typing is optional, never required.' },
  { icon: Brain, title: 'MediCue works out what they need', body: 'Each tap updates a probability over 20 needs. When it matters, it asks one more question, not ten.' },
  { icon: Stethoscope, title: 'The nurse gets a clear message', body: 'A structured request with a confidence figure arrives at the nurse station within a second.' },
] as const

const FEATURES = [
  { icon: Sparkles, title: 'Adaptive communication', body: 'When answering gets harder, the screen simplifies itself: fewer, bigger choices, then one yes/no question at a time.' },
  { icon: ShieldCheck, title: 'A safety floor', body: 'If a high-risk need is likely enough, MediCue alerts a nurse at once. That rule is fixed and works offline.' },
  { icon: ChartColumn, title: 'Catch it early', body: 'Trends against each patient’s own baseline surface slowing taps, silence and rising requests before they become urgent.' },
  { icon: Mic, title: 'Voice when it helps', body: 'Patients can speak instead of tapping, and the tablet can read questions aloud.' },
] as const

export default function FrontPage() {
  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(900px_420px_at_75%_-60px,oklch(0.93_0.04_262/0.5),transparent_70%),radial-gradient(600px_320px_at_5%_120px,oklch(0.96_0.02_255/0.6),transparent_70%)]" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))] md:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="MediCue home">
          <BrandMark className="size-9" />
          <span className="text-lg font-semibold tracking-tight">Medi<span className="text-pop">Cue</span></span>
        </Link>
        <AuthLink className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card/80 px-5 backdrop-blur text-sm font-medium shadow-[var(--shadow-panel)] hover:bg-muted" />
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:pb-32 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-20">
          <div className="rise flex flex-col gap-6">
            <p className="eyebrow inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1">
              <span className="size-1.5 rounded-full bg-pop" aria-hidden="true" /> Clinical communication aid
            </p>
            <h1 className="text-[clamp(2.5rem,1.6rem+3.8vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-balance">
              A voice for every patient who can’t <span className="text-gradient">speak</span>.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
              MediCue turns a few taps into a precise message for the care team, and tells them how certain it is.
              When answering gets harder, the tablet gets simpler.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <AuthLink arrow className="inline-flex min-h-12 items-center gap-2 btn-primary-grad rounded-full px-7 text-base font-medium text-primary-foreground transition-transform hover:-translate-y-0.5" />
              <a href="#how" className="inline-flex min-h-12 items-center rounded-full border border-border bg-card/80 px-6 text-base font-medium backdrop-blur hover:bg-card">
                See how it works
              </a>
            </div>
            <p className="text-sm text-muted-foreground">Prototype with synthetic patient data. A communication aid, not a diagnostic device.</p>
          </div>

          {/* Illustrative product mock: static, no patient data */}
          <div className="rise relative mx-auto w-full max-w-xl [animation-delay:0.15s]" aria-hidden="true">
            <div className="hero-glow absolute -inset-8 -z-10 rounded-[2.5rem] blur-2xl" />
            <div className="panel flex flex-col gap-4 p-5 sm:pb-32">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Needs you now</span>
                <span className="num rounded-full bg-urgent-soft px-2.5 py-0.5 text-xs font-medium text-urgent">Urgent</span>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xl font-semibold tracking-tight text-urgent">Pain in chest</p>
                <p className="text-sm text-muted-foreground">Room 12 · 2 min ago · or maybe shortness of breath</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border"><div className="grow h-full w-[82%] rounded-full bg-primary" /></div>
                <span className="num text-sm text-muted-foreground">82%</span>
              </div>
              <div className="flex gap-2">
                <span className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Confirm what they needed</span>
                <span className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-medium">Details</span>
              </div>
            </div>
            <div className="panel mt-4 p-4 shadow-xl sm:absolute sm:-bottom-16 sm:-left-8 sm:mt-0 sm:w-[56%]">
              <p className="eyebrow mb-2">Bedside tablet</p>
              <p className="mb-3 text-base font-semibold tracking-tight">Where is it?</p>
              <div className="grid grid-cols-2 gap-2">
                {['Back', 'Face', 'Chest', 'Whole body'].map((t) => (
                  <span key={t} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-medium">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-8 px-4 py-16 md:px-8">
          <div className="mb-10 flex max-w-2xl flex-col gap-3">
            <span className="page-title-bar" aria-hidden="true" />
            <p className="eyebrow">How it works</p>
            <h2 className="page-title">From a tap to a nurse, in a second.</h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="panel rise flex flex-col gap-4 p-6" style={{ animationDelay: `${0.1 * i}s` }}>
                <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-soft to-[oklch(0.94_0.03_220)] text-primary">
                  <s.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 md:px-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="panel flex gap-4 p-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <f.icon className="size-5" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                  <p className="leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 md:px-8">
          <div className="relative overflow-hidden rounded-[2rem] bg-[radial-gradient(120%_140%_at_100%_0%,oklch(0.33_0.07_259),transparent_60%),linear-gradient(135deg,oklch(0.28_0.065_259),oklch(0.25_0.06_261))] px-6 py-12 text-center text-white shadow-[0_20px_40px_-24px_oklch(0.3_0.08_262/0.5)] md:px-12">
            <h2 className="mx-auto max-w-2xl text-balance text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em]">
              Try the bedside tablet and the nurse station with demo accounts.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-white/75">The sign-in page has one-tap buttons for a demo patient and a demo nurse.</p>
            <AuthLink arrow className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-primary shadow-[0_8px_18px_-8px_oklch(0_0_0/0.5)] transition-transform hover:-translate-y-px" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card/60">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-muted-foreground md:px-8">
          <span className="flex items-center gap-2"><BrandMark className="size-6" /> MediCue</span>
          <span>Prototype with synthetic patient data. Not a diagnostic device.</span>
        </div>
      </footer>
    </div>
  )
}
