// Senior Stylist Service Worker
// 13I: Offline app-shell caching
// Strategy:
//   - Navigation requests: network-first, offline.html fallback
//   - Hashed static assets (/_next/static/**): cache-first, 30-day TTL
//   - API routes (/api/**): NEVER cache — always network, fail gracefully
//   - Everything else: network-first

const SHELL_CACHE = 'ss-shell-v1'
const STATIC_CACHE = 'ss-static-v1'

const PRECACHE_URLS = [
  '/offline.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return

  // NEVER cache API routes — always pass through
  if (url.pathname.startsWith('/api/')) return

  // Cache-first for hashed Next.js static assets (immutable, long TTL)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    )
    return
  }

  // Network-first for navigation and everything else, with offline fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE)
        return cache.match('/offline.html') || new Response('Offline', { status: 503 })
      })
    )
    return
  }

  // Default: network-first, no caching
  event.respondWith(fetch(request))
})

// Web Push (13Q)
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Senior Stylist', body: event.data.text() }
  }
  const options = {
    body: payload.body ?? '',
    icon: '/icon-192.png',
    badge: '/favicon-32x32.png',
    data: { url: payload.url ?? '/dashboard' },
    tag: payload.tag ?? 'ss-notification',
    renotify: !!payload.tag,
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Senior Stylist', options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/dashboard'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url === url && 'focus' in client) return client.focus()
        }
        if (self.clients.openWindow) return self.clients.openWindow(url)
      })
  )
})
