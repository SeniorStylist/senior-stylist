import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  calendarId: z.string().optional(),
  timezone: z.string().optional(),
  paymentType: z.enum(['facility', 'ip', 'rfms', 'hybrid']).optional(),
  stripePublishableKey: z.string().optional(),
  stripeSecretKey: z.string().optional(),
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

    return Response.json({ data: facility })
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

    const [updated] = await db
      .update(facilities)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(facilities.id, facilityUser.facilityId))
      .returning()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/facility error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
