'use client'

import './globals.css'
import { FallbackScreen } from '@/components/app/fallback-screen'

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="bg-background">
      <body className="font-sans antialiased">
        <FallbackScreen onRetry={reset} />
      </body>
    </html>
  )
}
