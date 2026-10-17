import { redirect } from 'next/navigation'

/** Renamed to Care forecast (the lead-time replay is at the bottom of that page). */
export default function EarlyWarningPage() {
  redirect('/nurse/forecast')
}
