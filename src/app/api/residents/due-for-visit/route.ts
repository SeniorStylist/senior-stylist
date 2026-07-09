// Phase 16 G2 — smart scheduling: residents who are DUE for a visit based on
// their own historical cadence. Query lives in lib/dashboard-panels.ts
// (Phase 25 — shared with the consolidated GET /api/dashboard/panels).

import { createClient } from '@/lib/supabase/server'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { getDueForVisit } from '@/lib/dashboard-panels'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser
    if (!isAdminOrAbove(role) && !isFacilityStaff(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const data = await getDueForVisit(facilityId)
    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/residents/due-for-visit error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
