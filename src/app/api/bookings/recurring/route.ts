import { db } from '@/db'
import { bookings, services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { addDays, addWeeks, addMonths } from 'date-fns'

const recurringSchema = z.object({
  residentId: z.string().uuid(),
  stylistId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startTime: z.string().datetime(),
  notes: z.string().optional(),
  recurringRule: z.enum(['weekly', 'biweekly', 'monthly']),
  recurringEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

type RecurringRule = 'weekly' | 'biweekly' | 'monthly'

function advanceDate(d: Date, rule: RecurringRule): Date {
  if (rule === 'weekly') return addWeeks(d, 1)
  if (rule === 'biweekly') return addDays(d, 14)
  return addMonths(d, 1)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 403 })

    const body = await request.json()
    const parsed = recurringSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

    const { residentId, stylistId, serviceId, startTime, notes, recurringRule, recurringEndDate } = parsed.data

    const service = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.facilityId, facilityUser.facilityId)),
    })
    if (!service) return Response.json({ error: 'Service not found' }, { status: 404 })

    const endDateLimit = new Date(recurringEndDate + 'T23:59:59Z')
    const parentStart = new Date(startTime)
    const parentEnd = new Date(parentStart.getTime() + service.durationMinutes * 60 * 1000)

    const [parent] = await db.insert(bookings).values({
      facilityId: facilityUser.facilityId,
      residentId,
      stylistId,
      serviceId,
      startTime: parentStart,
      endTime: parentEnd,
      priceCents: service.priceCents,
      durationMinutes: service.durationMinutes,
      notes: notes ?? null,
      status: 'scheduled',
      paymentStatus: 'unpaid',
      recurring: true,
      recurringRule,
      recurringEndDate,
    }).returning()

    let count = 0
    let currentStart = advanceDate(parentStart, recurringRule)

    while (currentStart <= endDateLimit) {
      const currentEnd = new Date(currentStart.getTime() + service.durationMinutes * 60 * 1000)
      try {
        await db.insert(bookings).values({
          facilityId: facilityUser.facilityId,
          residentId,
          stylistId,
          serviceId,
          startTime: currentStart,
          endTime: currentEnd,
          priceCents: service.priceCents,
          durationMinutes: service.durationMinutes,
          notes: notes ?? null,
          status: 'scheduled',
          paymentStatus: 'unpaid',
          recurring: true,
          recurringRule,
          recurringEndDate,
          recurringParentId: parent.id,
        })
        count++
      } catch {
        // Skip on conflict (e.g. stylist overlap)
      }
      currentStart = advanceDate(currentStart, recurringRule)
    }

    return Response.json({ data: { parentId: parent.id, count: count + 1 } })
  } catch (err) {
    console.error('POST /api/bookings/recurring error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
