import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents, stylists, facilities, stylistFacilityAssignments } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, ilike, or, asc } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const querySchema = z.string().min(2).max(100)

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && !facilityUser) {
      return Response.json({ error: 'No facility' }, { status: 400 })
    }

    const role = facilityUser?.role ?? ''
    if (!isMaster && role !== 'admin' && role !== 'bookkeeper') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rawQ = request.nextUrl.searchParams.get('q')
    const parsed = querySchema.safeParse(rawQ)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid query' }, { status: 400 })
    }
    const q = parsed.data

    const rl = await checkRateLimit('search', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const pattern = `%${q}%`
    const facilityId = facilityUser?.facilityId

    const [residentsRows, stylistsRows] = await Promise.all([
      db
        .select({
          id: residents.id,
          name: residents.name,
          roomNumber: residents.roomNumber,
          facilityId: residents.facilityId,
          facilityName: facilities.name,
        })
        .from(residents)
        .innerJoin(facilities, eq(facilities.id, residents.facilityId))
        .where(
          and(
            eq(residents.active, true),
            ilike(residents.name, pattern),
            isMaster || !facilityId ? undefined : eq(residents.facilityId, facilityId),
          ),
        )
        .orderBy(asc(residents.name))
        .limit(8),
      isMaster
        ? db
            .select({
              id: stylists.id,
              name: stylists.name,
              stylistCode: stylists.stylistCode,
              facilityId: stylists.facilityId,
              facilityName: facilities.name,
            })
            .from(stylists)
            .leftJoin(facilities, eq(facilities.id, stylists.facilityId))
            .where(
              and(
                eq(stylists.active, true),
                or(ilike(stylists.name, pattern), ilike(stylists.stylistCode, pattern)),
              ),
            )
            .orderBy(asc(stylists.name))
            .limit(8)
        : db
            .selectDistinct({
              id: stylists.id,
              name: stylists.name,
              stylistCode: stylists.stylistCode,
              facilityId: stylistFacilityAssignments.facilityId,
              facilityName: facilities.name,
            })
            .from(stylists)
            .innerJoin(
              stylistFacilityAssignments,
              and(
                eq(stylistFacilityAssignments.stylistId, stylists.id),
                eq(stylistFacilityAssignments.facilityId, facilityId!),
                eq(stylistFacilityAssignments.active, true),
              ),
            )
            .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
            .where(
              and(
                eq(stylists.active, true),
                or(ilike(stylists.name, pattern), ilike(stylists.stylistCode, pattern)),
              ),
            )
            .orderBy(asc(stylists.name))
            .limit(8),
    ])

    return Response.json({
      data: {
        residents: residentsRows,
        stylists: stylistsRows,
      },
    })
  } catch (err) {
    console.error('GET /api/search error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
