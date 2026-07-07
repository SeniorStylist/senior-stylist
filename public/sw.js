// Senior Stylist Service Worker — offline shell + push notifications
// Rules: network-first for navigations, cache-first for hashed statics, NEVER cache /api/*

const SHELL_CACHE = 'ss-shell-v2'
const STATIC_CACHE = 'ss-static-v1'
const OFFLINE_URL = '/offline.html'

// Hashed static assets (Next.js output — match /_next/static/)
function isHashedStatic(url) {
  return url.pathname.startsWith('/_next/static/')
}

// Navigation requests (HTML pages)
function isNavigation(request) {
  return request.mode === 'navigate'
}

// Never cache API routes
function isApi(url) {
  return url.pathname.startsWith('/api/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(OFFLINE_URL))
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
  const url = new URL(event.request.url)

  // Never intercept API calls — always go to network
  if (isApi(url)) return

  // Cache-first for hashed Next.js static assets (safe — content-addressed)
  if (isHashedStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok) cache.put(event.request, response.clone())
        return response
      })
    )
    return
  }

  // Network-first for navigations — serve offline page on failure
  if (isNavigation(event.request)) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE)
        return (await cache.match(OFFLINE_URL)) ?? Response.error()
      })
    )
    return
  }

  // All other requests: network-only (fonts, images, etc.)
})

// ─── Push notifications ───────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try { payload = event.data.json() } catch { return }

  const { title = 'Senior Stylist', body = '', url = '/' } = payload
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
