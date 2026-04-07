export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { getSuperAdminFacilities } from '@/lib/get-super-admin-facilities'

const schema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityIds = await getSuperAdminFacilities(user.id, user.email ?? '')
    if (facilityIds.length === 0) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }
    const { bookingIds } = parsed.data

    // Verify every booking belongs to an authorized facility
    const existing = await db
      .select({ id: bookings.id, facilityId: bookings.facilityId })
      .from(bookings)
      .where(inArray(bookings.id, bookingIds))

    const unauthorized = existing.filter((b) => !facilityIds.includes(b.facilityId))
    if (unauthorized.length > 0) {
      return Response.json({ error: 'Forbidden: some bookings are out of scope' }, { status: 403 })
    }

    // Mark all as paid
    await db
      .update(bookings)
      .set({ paymentStatus: 'paid', updatedAt: new Date() })
      .where(inArray(bookings.id, bookingIds))

    revalidateTag('bookings', {})

    return Response.json({ data: { updatedCount: bookingIds.length } })
  } catch (err) {
    console.error('POST /api/super-admin/reports/mark-paid error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
