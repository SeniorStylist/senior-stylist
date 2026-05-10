import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { signupSheetEntries, residents, services, stylists, stylistFacilityAssignments } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and, ne, asc, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getLocalParts } from '@/lib/time'
import { facilities, profiles } from '@/db/schema'

const createSchema = z.object({
  residentId: z.string().uuid().nullable(),
  residentName: z.string().min(1).max(200),
  roomNumber: z.string().max(50).nullable().optional(),
  serviceId: z.string().uuid().nullable(),
  serviceName: z.string().min(1).max(200),
  requestedTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).nullable().optional(),
  assignedToStylistId: z.string().uuid().nullable().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMaster = !!superAdminEmail && user.email === superAdminEmail

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser && !isMaster && !isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const facilityId = facilityUser?.facilityId
    if (!facilityId) return Response.json({ error: 'No facility' }, { status: 400 })

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    let roomNumber = parsed.data.roomNumber ?? null

    if (parsed.data.residentId) {
      const resident = await db.query.residents.findFirst({
        where: and(eq(residents.id, parsed.data.residentId), eq(residents.facilityId, facilityId)),
        columns: { id: true, roomNumber: true },
      })
      if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })
      if (!roomNumber && resident.roomNumber) roomNumber = resident.roomNumber
    }

    if (parsed.data.serviceId) {
      const service = await db.query.services.findFirst({
        where: and(eq(services.id, parsed.data.serviceId), eq(services.facilityId, facilityId)),
        columns: { id: true },
      })
      if (!service) return Response.json({ error: 'Service not found' }, { status: 404 })
    }

    if (parsed.data.assignedToStylistId) {
      const [assignment] = await db
        .select({ id: stylistFacilityAssignments.id })
        .from(stylistFacilityAssignments)
        .where(and(
          eq(stylistFacilityAssignments.stylistId, parsed.data.assignedToStylistId),
          eq(stylistFacilityAssignments.facilityId, facilityId),
          eq(stylistFacilityAssignments.active, true),
        ))
        .limit(1)
      if (!assignment) return Response.json({ error: 'Stylist is not assigned to this facility' }, { status: 404 })
    }

    const [created] = await db
      .insert(signupSheetEntries)
      .values({
        facilityId,
        residentId: parsed.data.residentId,
        residentName: parsed.data.residentName,
        roomNumber,
        serviceId: parsed.data.serviceId,
        serviceName: parsed.data.serviceName,
        requestedTime: parsed.data.requestedTime ?? null,
        requestedDate: parsed.data.requestedDate,
        notes: parsed.data.notes ?? null,
        createdBy: user.id,
        assignedToStylistId: parsed.data.assignedToStylistId ?? null,
        status: 'pending',
      })
      .returning()

    revalidateTag('signup-sheet', {})

    const full = await db.query.signupSheetEntries.findFirst({
      where: eq(signupSheetEntries.id, created.id),
      with: { resident: true, service: true, assignedStylist: true },
    })

    return Response.json({ data: full ?? created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/signup-sheet failed:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser

    const { searchParams } = new URL(request.url)
    let date = searchParams.get('date')

    if (!date) {
      const facility = await db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: { timezone: true },
      })
      const tz = facility?.timezone ?? 'America/New_York'
      const parts = getLocalParts(new Date(), tz)
      date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'Invalid date' }, { status: 422 })
    }

    const conditions = [
      eq(signupSheetEntries.facilityId, facilityId),
      eq(signupSheetEntries.requestedDate, date),
      ne(signupSheetEntries.status, 'cancelled'),
    ]

    // Stylists only see entries assigned to them OR unassigned.
    if (role === 'stylist') {
      const myProfile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      const myStylistId = myProfile?.stylistId
      if (!myStylistId) {
        return Response.json({ data: [] })
      }
      conditions.push(
        or(
          eq(signupSheetEntries.assignedToStylistId, myStylistId),
          isNull(signupSheetEntries.assignedToStylistId),
        )!
      )
    }

    const data = await db.query.signupSheetEntries.findMany({
      where: and(...conditions),
      with: { resident: true, service: true, assignedStylist: true },
      orderBy: [asc(signupSheetEntries.requestedTime), asc(signupSheetEntries.createdAt)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/signup-sheet failed:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
