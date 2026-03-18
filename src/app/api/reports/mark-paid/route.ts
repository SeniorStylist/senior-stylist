import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq, gte, lt } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const { month } = body as { month?: string }

    let whereClause
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mon] = month.split('-').map(Number)
      const start = new Date(year, mon - 1, 1)
      const end = new Date(year, mon, 1)
      whereClause = and(
        eq(bookings.facilityId, facilityUser.facilityId),
        eq(bookings.status, 'completed'),
        eq(bookings.paymentStatus, 'unpaid'),
        gte(bookings.startTime, start),
        lt(bookings.startTime, end)
      )
    } else {
      whereClause = and(
        eq(bookings.facilityId, facilityUser.facilityId),
        eq(bookings.status, 'completed'),
        eq(bookings.paymentStatus, 'unpaid')
      )
    }

    const updated = await db
      .update(bookings)
      .set({ paymentStatus: 'paid', updatedAt: new Date() })
      .where(whereClause)
      .returning({ id: bookings.id })

    return Response.json({ count: updated.length })
  } catch (err) {
    console.error('POST /api/reports/mark-paid error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
