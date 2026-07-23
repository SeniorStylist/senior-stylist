// Phase 18 — offline-cache teardown on sign-out. MUST be called from every
// staff sign-out path (settings, sidebar, unauthorized page): it wipes the
// localStorage read cache (resident names/rooms) AND tells the service worker
// to drop the per-user page cache (`ss-pages-*`). Without this, a cached
// authenticated page could be served to the NEXT user on a shared device.
//
// Deliberately does NOT touch `ss_offline_queue` — unsynced writes must
// survive a sign-out so they still replay when connectivity returns.

import { clearReadCache } from '@/lib/read-cache'

/** Drop only the SW per-user page cache (used by tutorial mode so demo-rendered
 *  HTML never lingers for offline serving; read cache + queue untouched). */
export function clearPageCache(): void {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_PAGES' })
    }
  } catch { /* best-effort */ }
}

export function clearOfflineOnLogout(): void {
  clearReadCache()
  // P46 — the assistant chat persists to localStorage and can contain
  // resident names; same shared-device rule as the read cache.
  try {
    localStorage.removeItem('ss_assistant_chat')
  } catch {
    /* best-effort */
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_PAGES' })
    }
  } catch {
    /* best-effort */
  }
}
