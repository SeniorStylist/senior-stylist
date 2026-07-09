// Phase 25 — consolidated dashboard-mount fetch. The admin dashboard used to
// fire three separate authenticated XHRs on mount (/api/stats, /api/waitlist,
// /api/residents/due-for-visit) — each paying its own getUser() network
// round-trip + facility_users lookup through the max:1 pooled connection.
// This handler authenticates ONCE and returns all three payloads; the
// standalone routes remain for post-mutation refetches.

import { createClient } from '@/lib/supabase/server'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { getFacilityStats, getPendingWaitlist, getDueForVisit } from '@/lib/dashboard-panels'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser

    const tutorialMode = isTutorialRequest(request)
    const adminOrStaff = isAdminOrAbove(role) || isFacilityStaff(role)

    // Per-section role gates mirror the standalone routes: stats for any
    // facility member, waitlist for non-viewers, due-for-visit for admin/staff.
    const [stats, waitlist, dueForVisit] = await Promise.all([
      getFacilityStats(facilityId, tutorialMode),
      role !== 'viewer' ? getPendingWaitlist(facilityId, tutorialMode) : Promise.resolve([]),
      adminOrStaff ? getDueForVisit(facilityId) : Promise.resolve([]),
    ])

    return Response.json({ data: { stats, waitlist, dueForVisit } })
  } catch (err) {
    console.error('GET /api/dashboard/panels error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
