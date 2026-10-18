'use client'

import { useEffect, useRef } from 'react'
import type { WsMessage } from '@/lib/types'

/** Pages that work without a login (a family member's phone, the patient's fallback screen). */
const NO_LOGIN = ['/login', '/family', '/simple']

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth/')
      && !NO_LOGIN.some((p) => window.location.pathname.startsWith(p))) {
    // The login is gone (expired, or the backend restarted and forgot it). Never keep showing a nurse an
    // out-of-date screen: send them to sign in again, which then shows the current list.
    window.location.href = '/login'
  }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
}

/** Subscribes to a backend pub/sub channel over the raw WebSocket; reconnects with backoff.
 *  `onOpen` runs on every (re)connect: messages sent while disconnected are lost, and a restarted backend has
 *  forgotten anything held only in memory, so pages reload their lists then instead of showing stale ones. */
export function useChannel(channel: string | null, onMessage: (m: WsMessage) => void, onOpen?: () => void) {
  const handler = useRef(onMessage)
  handler.current = onMessage
  const opened = useRef(onOpen)
  opened.current = onOpen

  useEffect(() => {
    if (!channel) return
    let ws: WebSocket | null = null
    let closed = false
    let retry = 500
    let ping: number | undefined

    const connect = () => {
      const base = process.env.NEXT_PUBLIC_BACKEND_WS ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
      ws = new WebSocket(`${base}/ws?channel=${encodeURIComponent(channel)}`)
      ws.onopen = () => {
        retry = 500
        opened.current?.()
        ping = window.setInterval(() => ws?.readyState === 1 && ws.send('ping'), 20000)
      }
      ws.onmessage = (e) => handler.current(JSON.parse(e.data))
      ws.onclose = () => {
        window.clearInterval(ping)
        if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 8000)))
      }
    }
    connect()
    return () => {
      closed = true
      window.clearInterval(ping)
      ws?.close()
    }
  }, [channel])
}

export const pct = (p: number) => `${Math.round(p * 100)}%`

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}
