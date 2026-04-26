import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { createMagicLink } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({ residentId: z.string().uuid() })

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!facilityUser && !isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (facilityUser && facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('portalRequestLink', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const whereClause = isMaster
      ? eq(residents.id, parsed.data.residentId)
      : and(eq(residents.id, parsed.data.residentId), eq(residents.facilityId, facilityUser!.facilityId))

    const resident = await db.query.residents.findFirst({
      where: whereClause,
      columns: { id: true, poaEmail: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })
    if (!resident.poaEmail) return Response.json({ error: 'No POA email on file' }, { status: 400 })

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { facilityCode: true },
    })
    if (!facility?.facilityCode) {
      return Response.json({ error: 'Facility has no code — set one before generating portal links' }, { status: 400 })
    }

    const link = await createMagicLink(resident.poaEmail, resident.id, facility.facilityCode, 72)
    return Response.json({ data: { link } })
  } catch (err) {
    console.error('POST /api/portal/create-magic-link error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
