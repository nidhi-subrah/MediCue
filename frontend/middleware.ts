import { NextResponse, type NextRequest } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'
const SESSION_COOKIE = 'ss_session'

type Me = { role: 'patient' | 'nurse'; patient_id: string | null } | null

async function getUser(request: NextRequest): Promise<Me> {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value
  if (!sessionId) return null
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function homeFor(user: NonNullable<Me>) {
  return user.role === 'nurse' ? '/nurse' : `/talk/${user.patient_id}`
}

/** Patients only ever get their own bedside tablet; everything else on this server is nurse-facing. */
/** Opened by a family member on their own device, or as the patient's accessibility fallback —
 *  neither has a login of its own, so neither goes through the patient/nurse gate. */
const UNGATED_PREFIXES = ['/family', '/simple']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (UNGATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }
  const user = await getUser(request)

  if (pathname === '/login') {
    if (user) return NextResponse.redirect(new URL(homeFor(user), request.url))
    return NextResponse.next()
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user.role === 'patient' && pathname !== `/talk/${user.patient_id}`) {
    return NextResponse.redirect(new URL(homeFor(user), request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
