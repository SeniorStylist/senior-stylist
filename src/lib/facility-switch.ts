'use client'

// Phase 25 — the ONE home for facility-switcher logic. Three surfaces render a
// facility picker (sidebar switcher, mobile facility header, daily-log header
// picker) and each used to reimplement sorting, name/F-code filtering, and the
// select-then-HARD-reload sequence. Trigger UIs stay bespoke per surface; the
// behavior lives here so it can't drift.

export interface SwitchableFacility {
  id: string
  name: string
  facilityCode?: string | null
}

export type FacilitySortOrder = 'fid' | 'name'

const SORT_KEY = 'facilitySortOrder'

export function loadFacilitySortOrder(): FacilitySortOrder {
  if (typeof window === 'undefined') return 'fid'
  return (localStorage.getItem(SORT_KEY) as FacilitySortOrder) ?? 'fid'
}

export function saveFacilitySortOrder(order: FacilitySortOrder) {
  try { localStorage.setItem(SORT_KEY, order) } catch { /* private browsing */ }
}

export function sortFacilitiesForSwitcher<T extends SwitchableFacility>(
  list: T[],
  order: FacilitySortOrder,
): T[] {
  return [...list].sort((a, b) => {
    if (order === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
    const numA = parseInt(a.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
    const numB = parseInt(b.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
    return numA - numB
  })
}

export function filterFacilitiesForSwitcher<T extends SwitchableFacility>(
  list: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (f) => f.name?.toLowerCase().includes(q) || f.facilityCode?.toLowerCase().includes(q),
  )
}

/**
 * Select a facility and HARD-reload. router.refresh() is NOT enough — it
 * re-runs server components but does not re-run client useState(initialProps)
 * initializers, so /log and /billing kept showing the OLD facility's data
 * ("switching doesn't work"). Same house rule as debug impersonation (Phase 23).
 * Never resolves on success (the reload tears the page down); callers should
 * set their own "switching…" state before calling.
 *
 * P60 — optional `destination`: a HARD navigation to that path after the
 * select (master-admin "Enter facility" / the new-facility flow land on
 * /dashboard). Still never a soft router.push — that reuses the (protected)
 * layout segment and leaves the Sidebar's switcher on the OLD facility.
 */
export async function switchFacility(facilityId: string, destination?: string): Promise<void> {
  await fetch('/api/facilities/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facilityId }),
  })
  if (destination) window.location.assign(destination)
  else window.location.reload()
}
