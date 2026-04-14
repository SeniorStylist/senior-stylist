import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylistAvailability, stylists, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, asc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const availabilitySchema = z.object({
  stylistId: z.string().uuid(),
  availability: z
    .array(
      z
        .object({
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: z.string().regex(/^\d{2}:\d{2}$/),
          endTime: z.string().regex(/^\d{2}:\d{2}$/),
          active: z.boolean(),
        })
        .refine((d) => !d.active || d.startTime < d.endTime, {
          message: 'startTime must be before endTime when active',
        })
    )
    .max(7)
    .refine(
      (rows) => new Set(rows.map((r) => r.dayOfWeek)).size === rows.length,
      { message: 'dayOfWeek must be unique' }
    ),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const stylistId = request.nextUrl.searchParams.get('stylistId')
    const parsed = z.string().uuid().safeParse(stylistId)
    if (!parsed.success) return Response.json({ error: 'stylistId required' }, { status: 422 })

    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== parsed.data) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const target = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, parsed.data), eq(stylists.facilityId, facilityUser.facilityId)),
      columns: { id: true },
    })
    if (!target) return Response.json({ error: 'Not found' }, { status: 404 })

    const availability = await db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.stylistId, parsed.data),
        eq(stylistAvailability.facilityId, facilityUser.facilityId)
      ),
      orderBy: [asc(stylistAvailability.dayOfWeek)],
    })

    return Response.json({ data: { availability } })
  } catch (err) {
    console.error('GET /api/availability error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const body = await request.json()
    const parsed = availabilitySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 422 })
    }
    const { stylistId, availability } = parsed.data

    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const target = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.facilityId, facilityUser.facilityId)),
      columns: { id: true },
    })
    if (!target) return Response.json({ error: 'Not found' }, { status: 404 })

    const rows = availability.map((r) => ({
      stylistId,
      facilityId: facilityUser.facilityId,
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      active: r.active,
    }))

    await db.transaction(async (tx) => {
      await tx.delete(stylistAvailability).where(eq(stylistAvailability.stylistId, stylistId))
      if (rows.length > 0) {
        await tx.insert(stylistAvailability).values(rows)
      }
    })

    const updated = await db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.stylistId, stylistId),
        eq(stylistAvailability.facilityId, facilityUser.facilityId)
      ),
      orderBy: [asc(stylistAvailability.dayOfWeek)],
    })

    return Response.json({ data: { availability: updated } })
  } catch (err) {
    console.error('PUT /api/availability error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
