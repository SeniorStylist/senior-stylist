// Phase 15 F6 — offline write-queue for stylists in bad-WiFi facilities.
//
// queueableFetch wraps a JSON write: on a NETWORK failure (fetch throws — never
// on an HTTP error response) the write is queued in localStorage and replayed
// FIFO when connectivity returns (window 'online', native networkStatusChange,
// app resume). HTTP errors still surface to the caller exactly like plain fetch.
//
// DOCUMENTED TRADEOFF: if a request reached the server but the response was lost,
// the replay duplicates the write. Booking-field PUTs and check-in are naturally
// idempotent-ish; walk-in POST is the real duplicate risk — accepted for v1 (the
// stylist sees a "saved offline" toast and the daily log after sync).
// PAYMENTS ARE NEVER QUEUED — do not route any /api/payments/* call through this.

export type QueueableResult = Response | { queued: true }

interface QueuedWrite {
  id: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  body: unknown
  label: string
  ts: number
  attempts: number
}

const KEY = 'ss_offline_queue'
const MAX_ENTRIES = 50
const MAX_ATTEMPTS = 3

type PendingListener = (count: number) => void
const listeners = new Set<PendingListener>()

function readQueue(): QueuedWrite[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : []
  } catch {
    return []
  }
}

function writeQueue(q: QueuedWrite[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(q))
  } catch {
    // storage full/unavailable — queue is best-effort
  }
  for (const cb of listeners) cb(q.length)
}

export function getPendingCount(): number {
  return readQueue().length
}

/** Subscribe to pending-count changes. Returns an unsubscribe function. */
export function subscribePending(cb: PendingListener): () => void {
  listeners.add(cb)
  cb(readQueue().length)
  return () => { listeners.delete(cb) }
}

export function isQueued(result: QueueableResult): result is { queued: true } {
  return typeof (result as { queued?: boolean }).queued === 'boolean'
}

/**
 * fetch a JSON write; on network throw, enqueue for replay and return {queued:true}.
 * HTTP error responses are returned as-is (caller keeps its rollback/error UX).
 */
export async function queueableFetch(
  label: string,
  url: string,
  init: { method: 'POST' | 'PUT' | 'PATCH'; body: unknown },
): Promise<QueueableResult> {
  try {
    return await fetch(url, {
      method: init.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(init.body),
    })
  } catch {
    // Network failure — queue it (oldest dropped past the cap, with a warning)
    const q = readQueue()
    if (q.length >= MAX_ENTRIES) {
      console.warn('[offline-queue] cap reached — dropping oldest entry:', q[0]?.label)
      q.shift()
    }
    q.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      method: init.method,
      body: init.body,
      label,
      ts: Date.now(),
      attempts: 0,
    })
    writeQueue(q)
    return { queued: true }
  }
}

let replaying = false

/**
 * Replay queued writes sequentially (FIFO). Success or HTTP 4xx → drop (a 4xx
 * will never succeed later); network throw → stop, keep the rest; HTTP 5xx →
 * retry up to MAX_ATTEMPTS then drop so the queue can never wedge.
 */
export async function replayQueue(): Promise<{ replayed: number; remaining: number }> {
  if (replaying) return { replayed: 0, remaining: getPendingCount() }
  replaying = true
  let replayed = 0
  try {
    let q = readQueue()
    while (q.length > 0) {
      const entry = q[0]
      let res: Response
      try {
        res = await fetch(entry.url, {
          method: entry.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry.body),
        })
      } catch {
        break // still offline — keep everything, try again on the next signal
      }
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        if (!res.ok) console.warn(`[offline-queue] dropped "${entry.label}" — server said ${res.status}`)
        q.shift()
        if (res.ok) replayed++
      } else {
        entry.attempts++
        if (entry.attempts >= MAX_ATTEMPTS) {
          console.warn(`[offline-queue] dropped "${entry.label}" after ${MAX_ATTEMPTS} 5xx attempts`)
          q.shift()
        }
        // persist the attempt counter, then stop this round — server is unhappy
        writeQueue(q)
        break
      }
      writeQueue(q)
      q = readQueue()
    }
    return { replayed, remaining: getPendingCount() }
  } finally {
    replaying = false
  }
}

// Web trigger — registered once at module load (SSR-guarded). Native triggers
// (networkStatusChange, app resume) live in <NativeBridge>.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void replayQueue() })
}
