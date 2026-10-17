'use client'

import { ArrowRight, BedDouble, NotebookPen, Tablet, Users } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/services/backend'
import type { Patient } from '@/lib/types'

/** No v0 screen covers a multi-patient ward view (in production, one tablet opens on
 *  one patient directly) — built with HomeView's exact card-grid visual language so it
 *  reads as a real staff landing page rather than a demo harness. */
export function HomeView() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Patient[]>('/api/patients').then(setPatients).catch((e) => setError(String(e)))
  }, [])

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-balance md:text-5xl">Patients</h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
          Open a patient&apos;s bedside tablet, or a family member&apos;s view. Requests reach the nurse station in real time.
        </p>
      </header>

      {error && (
        <p className="rounded-3xl border border-urgent/30 bg-urgent-soft p-5 text-base text-urgent">
          Can&apos;t reach the patient directory right now. ({error})
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {patients.map((p, i) => (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex h-full flex-col gap-5 rounded-3xl border-2 border-border bg-card p-6 md:min-h-56 md:p-7">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <BedDouble className="size-7" aria-hidden="true" />
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-sm text-muted-foreground">{p.room}</span>
                <span className="text-2xl font-bold">{p.name} <span className="text-base font-normal text-muted-foreground">{p.age}</span></span>
                <span className="text-base leading-relaxed text-muted-foreground">{p.diagnosis}</span>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link
                  href={`/talk/${p.id}`}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Tablet className="size-4" aria-hidden="true" />
                  Bedside tablet
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href={`/profile/${p.id}`}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:border-primary/40"
                >
                  <NotebookPen className="size-4" aria-hidden="true" />
                  Notes and profile
                </Link>
                {p.people.map((person) => (
                  <Link
                    key={person.id}
                    href={`/family/${person.id}`}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:border-primary/40"
                  >
                    <Users className="size-4" aria-hidden="true" />
                    {person.name.split(' ')[0]}, {person.relation}
                  </Link>
                ))}
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
