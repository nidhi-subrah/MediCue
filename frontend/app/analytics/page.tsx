import { redirect } from 'next/navigation'

/** Moved: the nurse-facing view is Unit insights; the Tiger Data internals are under "How this works". */
export default function AnalyticsPage() {
  redirect('/nurse/insights')
}
