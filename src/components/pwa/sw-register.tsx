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

function warmPages(role: string) {
  if (warmedThisSession || !navigator.onLine) return
  warmedThisSession = true
  const routes = WARM_ROUTES[role] ?? WARM_ROUTES.admin
  const run = () => {
    for (const route of routes) {
      // x-ss-warm routes this through the SW's page-cache branch; the response
      // is stored for offline use and otherwise discarded.
      fetch(route, { headers: { 'x-ss-warm': '1' } }).catch(() => {})
    }
  }
  if ('requestIdleCallback' in window) {
    ;(window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
      .requestIdleCallback(run, { timeout: 10_000 })
  } else {
    setTimeout(run, 4_000)
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
