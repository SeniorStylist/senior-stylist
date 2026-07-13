// Phase 17 — offline read cache (app-layer). P28 v2: IndexedDB-backed.
//
// The service worker deliberately NEVER caches /api/* (stale API responses
// silently serve wrong resident data), so offline reads live here instead:
// a network-first cache that pages consult only when the network throws.
//
// v2 (P28): storage moved from localStorage (1.5MB, contended with the write
// queue / nav prefs) to IndexedDB (`ss-readcache` DB, 25MB budget, 7-day age)
// with a localStorage fallback when IDB is unavailable (private browsing /
// ancient WebViews). Existing `ss_readcache:*` localStorage entries are
// migrated once and removed. public/offline.html reads the same DB via its
// own inline helper — keep DB_NAME/STORE in sync with it.
//
// Rules:
// - NEVER cache anything under /api/payments/* or any money-mutating response.
// - Cached data includes resident names/rooms — clearReadCache() MUST be called
//   on sign-out (staff settings + portal logout), same exposure class as the
//   ss_offline_queue.
// - Values are { data, at } and callers surface "saved copy from {time}" UI
//   whenever `stale` is true. Entries older than MAX_AGE_MS are not served.

const LEGACY_PREFIX = 'ss_readcache:'
const DB_NAME = 'ss-readcache'
const STORE = 'snapshots'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — survives a weekend gap
const MAX_TOTAL_BYTES = 25_000_000 // IDB is generous; still bounded

interface CacheEntry<T> {
  key: string
  data: T
  at: number // epoch ms when stored
  bytes: number
}

export interface CachedResult<T> {
  data: T
  at: number
  /** true when served from cache because the network was unreachable */
  stale: boolean
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing (mirrors the offline-photo-queue pattern)
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' })
          store.createIndex('at', 'at')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function idbPut(entry: CacheEntry<unknown>): Promise<boolean> {
  return openDb().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) return resolve(false)
        try {
          const tx = db.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).put(entry)
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => resolve(false)
          tx.onabort = () => resolve(false)
        } catch {
          resolve(false)
        }
      }),
  )
}

function idbGet(key: string): Promise<CacheEntry<unknown> | null> {
  return openDb().then(
    (db) =>
      new Promise<CacheEntry<unknown> | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, 'readonly')
          const req = tx.objectStore(STORE).get(key)
          req.onsuccess = () => resolve((req.result as CacheEntry<unknown>) ?? null)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

function idbAll(): Promise<CacheEntry<unknown>[]> {
  return openDb().then(
    (db) =>
      new Promise<CacheEntry<unknown>[]>((resolve) => {
        if (!db) return resolve([])
        try {
          const tx = db.transaction(STORE, 'readonly')
          const req = tx.objectStore(STORE).getAll()
          req.onsuccess = () => resolve((req.result as CacheEntry<unknown>[]) ?? [])
          req.onerror = () => resolve([])
        } catch {
          resolve([])
        }
      }),
  )
}

function idbDelete(keys: string[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db || keys.length === 0) return resolve()
        try {
          const tx = db.transaction(STORE, 'readwrite')
          const store = tx.objectStore(STORE)
          for (const k of keys) store.delete(k)
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      }),
  )
}

function idbClear(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve()
        try {
          const tx = db.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).clear()
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      }),
  )
}

/** Evict oldest entries until the cache fits the byte budget (best-effort). */
async function evictIfNeeded(): Promise<void> {
  try {
    const all = await idbAll()
    let total = all.reduce((sum, e) => sum + (e.bytes || 0), 0)
    if (total <= MAX_TOTAL_BYTES) return
    const sorted = [...all].sort((a, b) => a.at - b.at)
    const doomed: string[] = []
    for (const e of sorted) {
      if (total <= MAX_TOTAL_BYTES) break
      doomed.push(e.key)
      total -= e.bytes || 0
    }
    await idbDelete(doomed)
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// localStorage fallback (private browsing / no-IDB environments)
// ---------------------------------------------------------------------------

function lsGet(key: string): { data: unknown; at: number } | null {
  try {
    const raw = localStorage.getItem(LEGACY_PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as { data: unknown; at: number }
    if (!entry || typeof entry.at !== 'number') return null
    return entry
  } catch {
    return null
  }
}

function lsSet(key: string, data: unknown, at: number): void {
  try {
    localStorage.setItem(LEGACY_PREFIX + key, JSON.stringify({ data, at }))
  } catch { /* quota — best-effort */ }
}

function lsClearAll(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LEGACY_PREFIX)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// One-time migration of v1 localStorage entries into IDB
// ---------------------------------------------------------------------------

let migrated = false
async function migrateLegacy(): Promise<void> {
  if (migrated || typeof window === 'undefined') return
  migrated = true
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k)
    }
    if (keys.length === 0) return
    const db = await openDb()
    if (!db) return // no IDB — leave the localStorage copies as the live store
    for (const fullKey of keys) {
      const key = fullKey.slice(LEGACY_PREFIX.length)
      const entry = lsGet(key)
      if (entry && Date.now() - entry.at <= MAX_AGE_MS) {
        let bytes = 0
        try { bytes = JSON.stringify(entry.data).length * 2 } catch { bytes = 0 }
        await idbPut({ key, data: entry.data, at: entry.at, bytes })
      }
      try { localStorage.removeItem(fullKey) } catch { /* ignore */ }
    }
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Public API (same shape as v1; loads stay async via cachedFetch)
// ---------------------------------------------------------------------------

/** Persist a snapshot (e.g. SSR-seeded props on hydration). Fire-and-forget. */
export function saveSnapshot<T>(cacheKey: string, data: T): void {
  if (typeof window === 'undefined') return
  const at = Date.now()
  void migrateLegacy().then(async () => {
    const db = await openDb()
    if (db) {
      let bytes = 0
      try { bytes = JSON.stringify(data).length * 2 } catch { return }
      const ok = await idbPut({ key: cacheKey, data, at, bytes })
      if (ok) {
        void evictIfNeeded()
        return
      }
    }
    lsSet(cacheKey, data, at)
  })
}

/** Read a snapshot regardless of network state. Null when absent/expired. */
export async function loadSnapshot<T>(cacheKey: string): Promise<{ data: T; at: number } | null> {
  if (typeof window === 'undefined') return null
  await migrateLegacy()
  const entry = (await idbGet(cacheKey)) ?? lsGet(cacheKey)
  if (!entry || typeof entry.at !== 'number') return null
  if (Date.now() - entry.at > MAX_AGE_MS) return null
  return { data: entry.data as T, at: entry.at }
}

/**
 * Network-first cached GET. Fresh responses are stored and returned with
 * stale:false; a network THROW (offline) falls back to the last stored copy
 * with stale:true. HTTP error statuses are surfaced by returning
 * `{ httpError }` — they are real server answers, never masked by cache.
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
    const cached = await loadSnapshot<T>(cacheKey)
    if (cached) return { ...cached, stale: true }
    return null
  }
}

/** Wipe every cached snapshot — call on sign-out / portal logout. */
export function clearReadCache(): void {
  if (typeof window === 'undefined') return
  lsClearAll()
  void idbClear()
}

/** "3:42 PM" style label for offline notices. */
export function cacheTimeLabel(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}
