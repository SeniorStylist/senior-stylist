import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { sanitizeFacility } from '@/lib/sanitize'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  calendarId: z.string().optional(),
  timezone: z.string().optional(),
  paymentType: z.enum(['facility', 'ip', 'rfms', 'hybrid']).optional(),
  stripePublishableKey: z.string().optional(),
  stripeSecretKey: z.string().optional(),
  workingHours: z.object({
    days: z.array(z.string()),
    startTime: z.string(),
    endTime: z.string(),
  }).optional(),
  contactEmail: z.string().email().optional().nullable(),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const facility = await db.query.facilities.findFirst({
      where: (t, { eq }) => eq(t.id, facilityUser.facilityId),
    })
    if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })

    return Response.json({ data: sanitizeFacility(facility) })
  } catch (err) {
    console.error('GET /api/facility error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    // Only admins can update facility settings
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Check for duplicate name (case-insensitive) among active facilities, excluding current
    if (parsed.data.name) {
      const existing = await db.query.facilities.findFirst({
        where: (t, { and }) => and(
          sql`lower(${t.name}) = lower(${parsed.data.name!})`,
          eq(t.active, true),
          ne(t.id, facilityUser.facilityId)
        ),
      })
      if (existing) {
        return Response.json({ error: 'A facility with this name already exists' }, { status: 409 })
      }
    }

    const [updated] = await db
      .update(facilities)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(facilities.id, facilityUser.facilityId))
      .returning()

    return Response.json({ data: sanitizeFacility(updated) })
  } catch (err) {
    console.error('PUT /api/facility error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
