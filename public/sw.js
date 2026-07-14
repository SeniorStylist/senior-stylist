// Senior Stylist Service Worker — offline shell + per-user page cache + push
//
// Rules:
// - NEVER cache /api/* (stale API responses silently serve wrong data).
// - Page HTML is cached PER USER in `ss-pages-<userId>` (Phase 18). The app
//   posts SET_USER on login/layout mount (purges every other user's cache) and
//   CLEAR_PAGES on logout. This is what makes caching authenticated HTML safe
//   on shared devices: network-first keeps online users fresh, per-user keying
//   + wipe-on-auth-change closes the cross-user leak, and staleness is bounded
//   by the read-cache conventions in the app layer.
// - We deliberately store responses that carry `Cache-Control: no-store` (the
//   Cache Storage API ignores HTTP cache directives) — the middleware's
//   no-store intent (no cross-user reuse) is honored by the keying above.
// - RSC flight fetches (?_rsc=) are NOT intercepted: they Vary on the router
//   state tree, so a cached payload can corrupt the router. When one fails
//   offline, Next hard-navigates and the navigation branch serves cached HTML.

const SHELL_CACHE = 'ss-shell-v3' // P28 — bump ships the new offline.html hub immediately
const STATIC_CACHE = 'ss-static-v1'
const PAGE_CACHE_PREFIX = 'ss-pages-'
const OFFLINE_URL = '/offline.html'
const PAGE_CACHE_MAX_ENTRIES = 80 // P28 — Cache API quota is generous; a real workday's navigation history survives offline

let activeUserId = null
// P31 — in-memory page-cache entry count so putPage doesn't enumerate the whole
// cache (cache.keys()) on every navigation. null = unseeded (SW just started or
// the cache was purged); seeded once per SW lifetime, maintained incrementally.
let pageCacheCount = null

// Hashed static assets (Next.js output — match /_next/static/) plus the
// self-hosted font files (Phase 25 — immutable, versioned by filename) so
// offline pages keep their typography.
function isHashedStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')
}

// Navigation requests (HTML pages)
function isNavigation(request) {
  return request.mode === 'navigate'
}

// Never cache API routes
function isApi(url) {
  return url.pathname.startsWith('/api/')
}

// Paths that must never enter the page cache: auth surfaces, the family portal
// (separate session model), Next internals, and anything with a file extension.
function isPageCacheable(url) {
  const p = url.pathname
  if (
    p.startsWith('/api/') ||
    p.startsWith('/_next/') ||
    p.startsWith('/login') ||
    p.startsWith('/auth') ||
    p.startsWith('/invite') ||
    // /family + /portal stay EXCLUDED: portal sessions are cookie-based and
    // NOT keyed by the staff SET_USER isolation, so caching their HTML could
    // leak between portal users on a shared device. Family offline is served
    // by the offline.html family card (ss_portal_offline blob) instead.
    p.startsWith('/family') ||
    p.startsWith('/portal') ||
    p.startsWith('/unauthorized') ||
    p === OFFLINE_URL
  ) {
    return false
  }
  // Skip file-ish paths (images, manifest, sw itself, etc.)
  if (/\.[a-zA-Z0-9]+$/.test(p)) return false
  return true
}

function pageCacheName(userId) {
  return PAGE_CACHE_PREFIX + userId
}

// Re-derive the active user after a SW restart: by construction at most one
// ss-pages-* cache exists (SET_USER deletes the others).
async function resolveActiveUserId() {
  if (activeUserId) return activeUserId
  const keys = await caches.keys()
  const pageKey = keys.find((k) => k.startsWith(PAGE_CACHE_PREFIX))
  if (pageKey) activeUserId = pageKey.slice(PAGE_CACHE_PREFIX.length)
  return activeUserId
}

async function purgePageCaches(exceptUserId) {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((k) => k.startsWith(PAGE_CACHE_PREFIX))
      .filter((k) => !exceptUserId || k !== pageCacheName(exceptUserId))
      .map((k) => caches.delete(k))
  )
}

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'SET_USER' && typeof data.userId === 'string' && data.userId) {
    event.waitUntil(
      (async () => {
        // Idempotent: the client posts SET_USER on every layout mount, but the
        // purge (a full caches.keys() enumeration + deletes) only matters when
        // the user actually CHANGED. Same-user re-posts become a no-op.
        const current = await resolveActiveUserId()
        activeUserId = data.userId
        if (current === data.userId) return
        pageCacheCount = null
        await purgePageCaches(data.userId)
        await caches.open(pageCacheName(data.userId)) // ensure it exists for restart re-derivation
      })()
    )
  } else if (data.type === 'CLEAR_PAGES') {
    activeUserId = null
    pageCacheCount = null
    event.waitUntil(purgePageCaches(null))
  }
})

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(OFFLINE_URL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // P31 — Navigation Preload: the browser starts the network request for a
      // navigation IN PARALLEL with SW startup instead of waiting for the SW to
      // boot first. Biggest single win for hard-nav latency; no-op where
      // unsupported (event.preloadResponse then resolves undefined).
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable() } catch { /* best-effort */ }
      }
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE && !k.startsWith(PAGE_CACHE_PREFIX))
          .map((k) => caches.delete(k))
      )
    })()
  )
  self.clients.claim()
})

async function putPage(userId, url, response) {
  try {
    const cache = await caches.open(pageCacheName(userId))
    // Delete-then-put keeps eviction LRU-by-last-write (a re-put moves the
    // entry to the tail of the insertion order) and tells us whether the
    // count grew — no cache.keys() enumeration on the common path.
    const overwrote = await cache.delete(url)
    await cache.put(url, response)
    if (pageCacheCount === null) {
      pageCacheCount = (await cache.keys()).length // one enumeration per SW lifetime
    } else if (!overwrote) {
      pageCacheCount++
    }
    if (pageCacheCount > PAGE_CACHE_MAX_ENTRIES) {
      // Best-effort LRU: Cache API keys are insertion-ordered in practice.
      const keys = await cache.keys()
      const excess = keys.length - PAGE_CACHE_MAX_ENTRIES
      for (let i = 0; i < excess; i++) await cache.delete(keys[i])
      pageCacheCount = Math.min(keys.length, PAGE_CACHE_MAX_ENTRIES)
    }
  } catch {
    pageCacheCount = null // unknown state — reseed on next write
    /* quota — page caching is best-effort */
  }
}

// Network-first page handler shared by real navigations and warm requests.
async function handlePage(event, url, isWarm) {
  const userId = await resolveActiveUserId()
  try {
    // P31 — prefer the navigation-preload response (network request already in
    // flight since before the SW booted). Warm fetches are subresource fetches,
    // not navigations, so they have no preload. Unsupported browsers resolve
    // undefined → plain fetch (identical to the old path). A preload rejection
    // (offline) propagates to the catch below exactly like a fetch failure.
    let response = isWarm ? null : await event.preloadResponse
    if (!response) response = await fetch(event.request)
    const contentType = response.headers.get('content-type') || ''
    if (
      userId &&
      response.ok &&
      !response.redirected &&
      contentType.includes('text/html')
    ) {
      // Store under the clean URL (no volatile params) so a later offline
      // navigation to the same path matches regardless of how it was fetched.
      event.waitUntil(putPage(userId, url.origin + url.pathname + url.search, response.clone()))
    }
    return response
  } catch (err) {
    if (userId) {
      const cache = await caches.open(pageCacheName(userId))
      const cached =
        (await cache.match(url.origin + url.pathname + url.search, { ignoreVary: true })) ??
        (await cache.match(url.origin + url.pathname, { ignoreVary: true }))
      if (cached) return cached
    }
    if (isWarm) throw err
    const shell = await caches.open(SHELL_CACHE)
    return (await shell.match(OFFLINE_URL)) ?? Response.error()
  }
}

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

  // Per-user page cache: real navigations + idle-time warm fetches (Phase 18).
  // RSC (?_rsc=) fetches intentionally fall through untouched — see header.
  if (url.origin === self.location.origin && event.request.method === 'GET') {
    const isWarm = event.request.headers.get('x-ss-warm') === '1'
    if ((isNavigation(event.request) || isWarm) && isPageCacheable(url)) {
      event.respondWith(handlePage(event, url, isWarm))
      return
    }
    // Non-cacheable navigations (login, portal, …) keep the offline fallback.
    // Must ALSO consume the navigation-preload response here — once preload is
    // enabled it fires for EVERY navigation; ignoring it would double-hit the
    // server and log "preload was cancelled" warnings.
    if (isNavigation(event.request)) {
      event.respondWith(
        (async () => {
          try {
            const preloaded = await event.preloadResponse
            if (preloaded) return preloaded
            return await fetch(event.request)
          } catch {
            const cache = await caches.open(SHELL_CACHE)
            return (await cache.match(OFFLINE_URL)) ?? Response.error()
          }
        })()
      )
      return
    }
  }

  // All other requests: network-only (fonts, images, RSC fetches, etc.)
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
