import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, services, stylists } from '@/db/schema'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'

// Roster data (residents / stylists / services) for a target facility, used by the
// scan-review modal when a bookkeeper/master imports a scan to a facility other than
// their pinned one — so Gemini gets the RIGHT name lists and the review dropdowns
// show the target facility's records instead of the pinned facility's.

const querySchema = z.object({ facilityId: z.string().uuid() })

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMasterAdmin = !!superAdminEmail && user.email === superAdminEmail
    if (!isMasterAdmin && !canScanLogs(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = querySchema.safeParse({
      facilityId: request.nextUrl.searchParams.get('facilityId') ?? '',
    })
    if (!parsed.success) {
      return Response.json({ error: 'Invalid facilityId' }, { status: 400 })
    }
    const { facilityId } = parsed.data

    // Cross-facility rosters: bookkeeper + master only. Admin/facility_staff are
    // pinned to their own facility (mirrors POST /api/log/ocr/import).
    if (facilityId !== facilityUser.facilityId) {
      if (!isMasterAdmin && facilityUser.role !== 'bookkeeper') {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const target = await db.query.facilities.findFirst({
        where: and(eq(facilities.id, facilityId), eq(facilities.active, true)),
        columns: { id: true },
      })
      if (!target) return Response.json({ error: 'Facility not found' }, { status: 404 })
    }

    const [residentRows, stylistRows, serviceRows] = await Promise.all([
      db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, facilityId),
          eq(residents.active, true),
          eq(residents.isDemo, false),
        ),
        columns: { id: true, name: true, roomNumber: true },
        orderBy: [asc(residents.name)],
      }),
      db.query.stylists.findMany({
        where: and(
          eq(stylists.facilityId, facilityId),
          eq(stylists.active, true),
          eq(stylists.isDemo, false),
        ),
        columns: { id: true, name: true },
        orderBy: [asc(stylists.name)],
      }),
      db.query.services.findMany({
        where: and(
          eq(services.facilityId, facilityId),
          eq(services.active, true),
          eq(services.isDemo, false),
        ),
        columns: { id: true, name: true, priceCents: true, pricingType: true },
        orderBy: [asc(services.name)],
      }),
    ])

    return Response.json({
      data: { residents: residentRows, stylists: stylistRows, services: serviceRows },
    })
  } catch (err) {
    console.error('GET /api/log/ocr/rosters error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
