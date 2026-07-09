import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { residentCreateSchema } from '@/lib/validation/resident-create'

// Phase 25 — schema lives in src/lib/validation/resident-create.ts so client
// payload builders can type against ResidentCreateInput (drift = tsc error).
const createSchema = residentCreateSchema

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
    if (!isMaster && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    // Optional ?facilityId=X param: master admin can query any facility;
    // regular admin can only query their own facility.
    const paramFacilityId = new URL(request.url).searchParams.get('facilityId')
    let facilityId: string
    if (paramFacilityId) {
      if (!isMaster && facilityUser?.facilityId !== paramFacilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      facilityId = paramFacilityId
    } else {
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      facilityId = facilityUser.facilityId
    }

    // is_demo filter — Phase 13. Demo-only during a scripted tour; real-only otherwise.
    const data = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true), eq(residents.isDemo, isTutorialRequest(request))),
      columns: paramFacilityId
        ? { id: true, name: true, roomNumber: true }
        : undefined,
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/residents error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { name, roomNumber, phone } = parsed.data
    const portalToken = crypto.randomBytes(8).toString('hex')

    const [created] = await db
      .insert(residents)
      .values({ facilityId, name, roomNumber: roomNumber ?? null, phone: phone ?? null, portalToken, isDemo: isTutorialRequest(request) })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/residents error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
