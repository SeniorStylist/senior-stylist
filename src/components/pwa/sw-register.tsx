'use client'

// Registers the service worker and (Phase 18) binds the per-user page cache:
// - posts SET_USER so the SW keys cached pages to this account and purges any
//   previous user's pages (shared-device safety)
// - warms the role's nav destinations once per session (idle, online-only) so
//   offline navigation has pages to serve — soft navigations never produce
//   HTML responses, so without warming only hard-loaded pages would be cached.

import { useEffect } from 'react'

// Per-role destinations to pre-warm. Mirrors the mobile-nav destination set;
// keep in sync when adding a top-level page. Cheap: one HTML render each, once
// per session, at idle.
const WARM_ROUTES: Record<string, string[]> = {
  admin: ['/dashboard', '/log', '/residents', '/signup-sheet', '/analytics', '/payroll', '/settings', '/help'],
  super_admin: ['/dashboard', '/log', '/residents', '/signup-sheet', '/analytics', '/payroll', '/settings', '/help'],
  facility_staff: ['/dashboard', '/log', '/signup-sheet', '/residents', '/settings', '/help'],
  stylist: ['/dashboard', '/log', '/my-account', '/help'],
  bookkeeper: ['/log', '/analytics', '/payroll', '/settings', '/help'],
  viewer: ['/help'],
}

let warmedThisSession = false

// Phase 21 — warming is SEQUENTIAL and once per browser session. The first
// version fired 8 CONCURRENT full SSR renders and re-fired on every hard
// reload (module flag resets), which starved the DB's single pooled
// connection (max: 1) and 500'd the whole site. Never parallelize this.
function warmPages(role: string) {
  if (warmedThisSession || !navigator.onLine) return
  try {
    if (sessionStorage.getItem('ss_warmed') === '1') return
  } catch { /* private browsing — module flag still guards this tab */ }
  // Never warm (and therefore cache) demo-mode renders during a tutorial.
  if (document.cookie.includes('ss_tutorial_mode=')) return
  // Respect data-saver connections.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return
  warmedThisSession = true
  try { sessionStorage.setItem('ss_warmed', '1') } catch { /* ignore */ }
  const routes = WARM_ROUTES[role] ?? WARM_ROUTES.admin
  const run = async () => {
    for (const route of routes) {
      if (!navigator.onLine) return
      if (document.cookie.includes('ss_tutorial_mode=')) return
      try {
        // x-ss-warm routes this through the SW's page-cache branch; the
        // response is stored for offline use and otherwise discarded.
        await fetch(route, { headers: { 'x-ss-warm': '1' } })
      } catch { /* offline mid-run — stop quietly */ }
      // Breathe between renders — one at a time, never a stampede.
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  const start = () => { void run() }
  if ('requestIdleCallback' in window) {
    // 5s floor + idle callback so warming never competes with initial load.
    setTimeout(() => {
      ;(window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
        .requestIdleCallback(start, { timeout: 10_000 })
    }, 5_000)
  } else {
    setTimeout(start, 8_000)
  }
}

export function SWRegister({ userId, role }: { userId?: string; role?: string }) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[SWRegister] registration failed:', err))

    if (!userId) return
    const postUser = () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'SET_USER', userId })
    }
    void navigator.serviceWorker.ready.then((reg) => {
      // controller can be null on the very first load (SW not yet controlling);
      // reg.active covers that window, controllerchange covers takeover.
      ;(navigator.serviceWorker.controller ?? reg.active)?.postMessage({ type: 'SET_USER', userId })
      if (role) warmPages(role)
    })
    navigator.serviceWorker.addEventListener('controllerchange', postUser)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', postUser)
  }, [userId, role])

  return null
}
