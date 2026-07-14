'use client'

// Phase 25 — shared client fetch for GET /api/dashboard/panels. Three
// dashboard consumers (period stats, WaitlistPanel, DueForVisitPanel) used to
// fire three separate authenticated XHRs on mount; they now share ONE request
// via this module-level in-flight cache. `fresh: true` forces a refetch after
// a mutation — calls arriving within 500ms of a fresh fetch reuse it, so both
// panels bumping the same reloadKey still produce a single request.

import type { WaitlistEntry } from '@/components/waitlist/waitlist-panel'
import type { DueResident } from '@/components/dashboard/due-for-visit-panel'

export interface DashboardPanelsData {
  // null for stylist/viewer callers — facility-wide stats are office-only (P30)
  stats: {
    today: { count: number; revenueCents: number }
    thisWeek: { count: number; revenueCents: number }
    thisMonth: { count: number; revenueCents: number }
  } | null
  waitlist: WaitlistEntry[]
  dueForVisit: DueResident[]
}

let cached: { at: number; p: Promise<DashboardPanelsData | null> } | null = null

export function fetchDashboardPanels(fresh = false): Promise<DashboardPanelsData | null> {
  const now = Date.now()
  if (cached && (!fresh || now - cached.at < 500)) return cached.p
  const p = fetch('/api/dashboard/panels')
    .then(async (r) => {
      if (!r.ok) return null
      const j = await r.json()
      return (j.data ?? null) as DashboardPanelsData | null
    })
    .catch(() => null)
  cached = { at: now, p }
  return p
}
