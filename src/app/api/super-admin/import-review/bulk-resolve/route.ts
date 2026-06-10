import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, services } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
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

const bulkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('keep'),
    bookingIds: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('link'),
    bookingIds: z.array(z.string().uuid()).min(1).max(500),
    serviceId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('create'),
    bookingIds: z.array(z.string().uuid()).min(1).max(500),
    serviceName: z.string().min(1).max(200),
    priceCents: z.number().int().min(0).max(10_000_000),
  }),
])

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const parsed = bulkSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request', details: parsed.error.format() }, { status: 400 })
    }

    const { bookingIds } = parsed.data

    // Only operate on bookings that are actually still in the queue
    const targetBookings = await db.query.bookings.findMany({
      where: and(
        inArray(bookings.id, bookingIds),
        eq(bookings.active, true),
        eq(bookings.needsReview, true),
      ),
      columns: { id: true, facilityId: true },
    })

    if (targetBookings.length === 0) {
      return Response.json({ data: { resolved: 0 } })
    }

    const targetIds = targetBookings.map((b) => b.id)

    if (parsed.data.action === 'link' || parsed.data.action === 'create') {
      // Link and create require all bookings to share a single facility
      const facilitySet = new Set(targetBookings.map((b) => b.facilityId))
      if (facilitySet.size > 1) {
        return Response.json(
          { error: 'All selected bookings must be from the same facility to link or create a service.' },
          { status: 400 },
        )
      }
      const [facilityId] = [...facilitySet]

      if (parsed.data.action === 'link') {
        // Cross-facility leak guard
        const svc = await db.query.services.findFirst({
          where: and(eq(services.id, parsed.data.serviceId), eq(services.facilityId, facilityId)),
          columns: { id: true },
        })
        if (!svc) {
          return Response.json({ error: 'Service does not belong to this facility' }, { status: 400 })
        }
        await db
          .update(bookings)
          .set({ serviceId: parsed.data.serviceId, serviceIds: [parsed.data.serviceId], needsReview: false, updatedAt: new Date() })
          .where(inArray(bookings.id, targetIds))
      } else {
        // create one service, link all selected bookings to it
        const { serviceName, priceCents } = parsed.data
        await db.transaction(async (tx) => {
          const [newSvc] = await tx
            .insert(services)
            .values({ facilityId, name: serviceName, priceCents, pricingType: 'fixed', durationMinutes: 30, active: true })
            .returning({ id: services.id })
          await tx
            .update(bookings)
            .set({ serviceId: newSvc.id, serviceIds: [newSvc.id], needsReview: false, updatedAt: new Date() })
            .where(inArray(bookings.id, targetIds))
        })
      }
    } else {
      // keep
      await db
        .update(bookings)
        .set({ needsReview: false, updatedAt: new Date() })
        .where(inArray(bookings.id, targetIds))
    }

    revalidateTag('bookings', {})
    return Response.json({ data: { resolved: targetIds.length } })
  } catch (err) {
    console.error('[bulk-resolve] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
