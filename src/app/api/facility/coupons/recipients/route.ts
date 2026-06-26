import { db } from '@/db'
import { portalAccountResidents, portalAccounts, residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

// Residents at the facility that have a linked portal (POA) account — the only
// valid recipients for issuing a coupon. One row per (resident, account).
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const fu = await getUserFacility(user.id)
    if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
    if (fu.role !== 'admin' && fu.role !== 'super_admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rows = await db
      .select({
        residentId: residents.id,
        residentName: residents.name,
        roomNumber: residents.roomNumber,
        portalAccountId: portalAccounts.id,
        email: portalAccounts.email,
      })
      .from(portalAccountResidents)
      .innerJoin(residents, eq(residents.id, portalAccountResidents.residentId))
      .innerJoin(portalAccounts, eq(portalAccounts.id, portalAccountResidents.portalAccountId))
      .where(and(eq(portalAccountResidents.facilityId, fu.facilityId), eq(residents.active, true)))
      .orderBy(residents.name)

    return Response.json({ data: rows })
  } catch (err) {
    console.error('GET /api/facility/coupons/recipients error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
