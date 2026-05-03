import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, services } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

const resolveSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link'),
    bookingId: z.string().uuid(),
    serviceId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('create'),
    bookingId: z.string().uuid(),
    serviceName: z.string().min(1).max(200),
    priceCents: z.number().int().min(0).max(10_000_000),
  }),
  z.object({
    action: z.literal('keep'),
    bookingId: z.string().uuid(),
  }),
])

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = resolveSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request', details: parsed.error.format() }, { status: 400 })
    }
    const { bookingId } = parsed.data

    // Verify booking exists, is in queue
    const booking = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, bookingId), eq(bookings.active, true), eq(bookings.needsReview, true)),
      columns: { id: true, facilityId: true },
    })
    if (!booking) {
      return Response.json({ error: 'Booking not found or already resolved' }, { status: 404 })
    }

    if (parsed.data.action === 'link') {
      // Cross-facility leak guard: verify serviceId belongs to booking's facility
      const svc = await db.query.services.findFirst({
        where: and(eq(services.id, parsed.data.serviceId), eq(services.facilityId, booking.facilityId)),
        columns: { id: true },
      })
      if (!svc) {
        return Response.json({ error: 'Service does not belong to this facility' }, { status: 400 })
      }
      await db
        .update(bookings)
        .set({ serviceId: parsed.data.serviceId, serviceIds: [parsed.data.serviceId], needsReview: false, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId))
    } else if (parsed.data.action === 'create') {
      const { serviceName, priceCents } = parsed.data
      await db.transaction(async (tx) => {
        const [newSvc] = await tx
          .insert(services)
          .values({
            facilityId: booking.facilityId,
            name: serviceName,
            priceCents,
            pricingType: 'fixed',
            durationMinutes: 30,
            active: true,
          })
          .returning({ id: services.id })
        await tx
          .update(bookings)
          .set({ serviceId: newSvc.id, serviceIds: [newSvc.id], needsReview: false, updatedAt: new Date() })
          .where(eq(bookings.id, bookingId))
      })
    } else {
      // keep
      await db
        .update(bookings)
        .set({ needsReview: false, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId))
    }

    revalidateTag('bookings', {})
    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[import-review resolve] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
