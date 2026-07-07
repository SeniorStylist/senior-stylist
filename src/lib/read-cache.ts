// Phase 17 — offline read cache (localStorage, app-layer).
//
// The service worker deliberately NEVER caches /api/* (stale API responses
// silently serve wrong resident data), so offline reads live here instead:
// a small network-first cache that pages consult only when the network throws.
//
// Rules:
// - NEVER cache anything under /api/payments/* or any money-mutating response.
// - Cached data includes resident names/rooms — clearReadCache() MUST be called
//   on sign-out (staff settings + portal logout), same exposure class as the
//   ss_offline_queue.
// - Values are { data, at } and callers surface "saved copy from {time}" UI
//   whenever `stale` is true. Entries older than MAX_AGE_MS are not served.

const PREFIX = 'ss_readcache:'
const MAX_AGE_MS = 72 * 60 * 60 * 1000 // 3 days — beyond that a stale day sheet is more confusing than helpful
const MAX_TOTAL_BYTES = 1_500_000 // stay well under the ~5MB localStorage budget

interface CacheEntry<T> {
  data: T
  at: number // epoch ms when stored
}

export interface CachedResult<T> {
  data: T
  at: number
  /** true when served from cache because the network was unreachable */
  stale: boolean
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function allCacheKeys(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
  } catch { /* private browsing */ }
  return keys
}

/** Evict oldest entries until the cache fits the byte budget. */
function evictIfNeeded() {
  try {
    const entries = allCacheKeys()
      .map((k) => {
        const raw = safeGet(k)
        let at = 0
        try {
          at = raw ? (JSON.parse(raw) as CacheEntry<unknown>).at ?? 0 : 0
        } catch { /* corrupt — treat as oldest */ }
        return { k, at, bytes: (raw?.length ?? 0) * 2 }
      })
      .sort((a, b) => a.at - b.at)
    let total = entries.reduce((sum, e) => sum + e.bytes, 0)
    for (const e of entries) {
      if (total <= MAX_TOTAL_BYTES) break
      localStorage.removeItem(e.k)
      total -= e.bytes
    }
  } catch { /* best-effort */ }
}

/** Persist a snapshot (e.g. SSR-seeded props on hydration). */
export function saveSnapshot<T>(cacheKey: string, data: T): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CacheEntry<T> = { data, at: Date.now() }
    localStorage.setItem(PREFIX + cacheKey, JSON.stringify(entry))
    evictIfNeeded()
  } catch { /* quota / private browsing — cache is best-effort */ }
}

/** Read a snapshot regardless of network state. Null when absent/expired. */
export function loadSnapshot<T>(cacheKey: string): { data: T; at: number } | null {
  if (typeof window === 'undefined') return null
  const raw = safeGet(PREFIX + cacheKey)
  if (!raw) return null
  try {
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (!entry || typeof entry.at !== 'number') return null
    if (Date.now() - entry.at > MAX_AGE_MS) return null
    return { data: entry.data, at: entry.at }
  } catch {
    return null
  }
}

/**
 * Network-first cached GET. Fresh responses are stored and returned with
 * stale:false; a network THROW (offline) falls back to the last stored copy
 * with stale:true. HTTP error statuses are surfaced by returning null after
 * `onHttpError` — they are real server answers, never masked by cache.
 */
export async function cachedFetch<T>(
  cacheKey: string,
  url: string,
  opts?: { extract?: (json: unknown) => T },
): Promise<CachedResult<T> | { httpError: Response } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { httpError: res }
    const json: unknown = await res.json()
    const data = opts?.extract ? opts.extract(json) : (json as T)
    saveSnapshot(cacheKey, data)
    return { data, at: Date.now(), stale: false }
  } catch {
    const cached = loadSnapshot<T>(cacheKey)
    if (cached) return { ...cached, stale: true }
    return null
  }
}

/** Wipe every cached snapshot — call on sign-out / portal logout. */
export function clearReadCache(): void {
  if (typeof window === 'undefined') return
  try {
    for (const k of allCacheKeys()) localStorage.removeItem(k)
  } catch { /* ignore */ }
}

/** "3:42 PM" style label for offline notices. */
export function cacheTimeLabel(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}
