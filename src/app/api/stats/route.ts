import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { getFacilityStats } from '@/lib/dashboard-panels'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    // P30 lockdown — facility-wide revenue/counts are not for stylists (the
    // dashboard tiles are admin-only; this closes the direct-call path).
    if (facilityUser.role === 'stylist' || facilityUser.role === 'viewer') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Phase 25 — one aggregate query in lib/dashboard-panels.ts (was three
    // unbounded findMany reads with a service join, reduced in JS).
    const data = await getFacilityStats(facilityUser.facilityId, isTutorialRequest(request))
    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/stats error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
