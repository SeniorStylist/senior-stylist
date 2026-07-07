// Phase 18 — offline queue for booking style photos. Photos are binary
// (FormData), so they can't ride the JSON write-queue in offline-queue.ts —
// this module stores the blob in IndexedDB (native API, no dependency) and
// replays multipart POSTs to /api/residents/[id]/photos when connectivity
// returns. Mirrors offline-queue.ts semantics: enqueue ONLY on network throw,
// drop on 4xx, retry 5xx up to 3×, stop-and-keep on network failure.
// PAYMENTS ARE NEVER QUEUED — this module is photos-only by construction.

const DB_NAME = 'ss-offline-photos'
const DB_VERSION = 1
const STORE = 'photos'
const MAX_ENTRIES = 20 // photos are MBs each — keep the cap tight
const MAX_ATTEMPTS = 3

export interface QueuedPhoto {
  id: string
  residentId: string
  bookingId: string | null
  caption: string
  sharedWithFamily: boolean
  blob: Blob
  fileName: string
  at: number
  attempts: number
}

type PendingListener = (count: number) => void
const listeners = new Set<PendingListener>()
let cachedCount = 0

function notify(count: number) {
  cachedCount = count
  listeners.forEach((cb) => {
    try { cb(count) } catch { /* listener errors never break the queue */ }
  })
}

export function getPhotoPendingCount(): number {
  return cachedCount
}

export function subscribePhotoPending(cb: PendingListener): () => void {
  listeners.add(cb)
  cb(cachedCount)
  return () => listeners.delete(cb)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
  })
}

async function readAll(): Promise<QueuedPhoto[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const rows = await new Promise<QueuedPhoto[]>((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve((req.result as QueuedPhoto[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    return rows.sort((a, b) => a.at - b.at)
  } finally {
    db.close()
  }
}

async function refreshCount(): Promise<void> {
  try {
    const rows = await readAll()
    notify(rows.length)
  } catch { /* IDB unavailable — count stays 0 */ }
}

/** Queue a photo for later upload. Returns false when storage is unavailable/full. */
export async function enqueuePhoto(entry: {
  residentId: string
  bookingId: string | null
  caption: string
  sharedWithFamily: boolean
  blob: Blob
  fileName: string
}): Promise<boolean> {
  try {
    const rows = await readAll()
    if (rows.length >= MAX_ENTRIES) return false
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({
        ...entry,
        id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        attempts: 0,
      } satisfies QueuedPhoto)
      await txDone(tx)
    } finally {
      db.close()
    }
    await refreshCount()
    return true
  } catch {
    return false
  }
}

async function removePhoto(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}

async function bumpAttempts(entry: QueuedPhoto): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...entry, attempts: entry.attempts + 1 })
    await txDone(tx)
  } finally {
    db.close()
  }
}

let replaying = false

/** FIFO replay. 4xx → drop; 5xx → retry up to MAX_ATTEMPTS; network throw → stop-and-keep. */
export async function replayPhotoQueue(): Promise<{ uploaded: number; remaining: number }> {
  if (replaying) return { uploaded: 0, remaining: cachedCount }
  replaying = true
  let uploaded = 0
  try {
    const rows = await readAll()
    for (const entry of rows) {
      const form = new FormData()
      form.append('file', entry.blob, entry.fileName)
      if (entry.caption) form.append('caption', entry.caption)
      form.append('sharedWithFamily', entry.sharedWithFamily ? 'true' : 'false')
      if (entry.bookingId) form.append('bookingId', entry.bookingId)
      try {
        const res = await fetch(`/api/residents/${entry.residentId}/photos`, {
          method: 'POST',
          body: form,
        })
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          // Success, or a permanent rejection (auth/validation) — drop either way.
          await removePhoto(entry.id)
          if (res.ok) uploaded++
        } else {
          // 5xx — transient server trouble
          if (entry.attempts + 1 >= MAX_ATTEMPTS) await removePhoto(entry.id)
          else await bumpAttempts(entry)
          break
        }
      } catch {
        // Still offline — keep everything, try again on the next trigger.
        break
      }
    }
  } catch { /* IDB unavailable */ }
  finally {
    replaying = false
    await refreshCount()
  }
  const rows = await readAll().catch(() => [] as QueuedPhoto[])
  return { uploaded, remaining: rows.length }
}

// Auto-replay when connectivity returns (mirrors offline-queue.ts); also prime
// the pending count on module load so banners show queued photos after reload.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void replayPhotoQueue() })
  void refreshCount()
}
