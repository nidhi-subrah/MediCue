const CACHE_NAME = 'silentsignal-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/offline.html'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    url.pathname.startsWith('/apple-icon') ||
    url.pathname.endsWith('.woff2')
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache API calls or anything that could carry patient/clinical data.
  if (url.pathname.startsWith('/api/')) return

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html')),
    )
  }
})
