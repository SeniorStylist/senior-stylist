import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, services, bookings } from '@/db/schema'
import { z } from 'zod'
import crypto from 'crypto'

const importSchema = z.object({
  sheets: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      stylistId: z.string().uuid(),
      entries: z.array(
        z.object({
          include: z.boolean(),
          residentId: z.string().uuid().nullable(),
          residentName: z.string().min(1),
          roomNumber: z.string().nullable(),
          serviceId: z.string().uuid().nullable(),
          serviceName: z.string().min(1),
          priceCents: z.number().int().min(0).nullable(),
          notes: z.string().nullable(),
        })
      ),
    })
  ),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMasterAdmin = superAdminEmail && user.email === superAdminEmail
    if (!isMasterAdmin && facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const facilityId = facilityUser.facilityId

    const body = await request.json()
    const parsed = importSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    let createdResidents = 0
    let createdServices = 0
    let createdBookings = 0

    await db.transaction(async (tx) => {
      for (const sheet of parsed.data.sheets) {
        const includedEntries = sheet.entries.filter((e) => e.include)
        let entryIndex = 0

        for (const entry of includedEntries) {
          // Resolve or create resident
          let residentId = entry.residentId
          if (!residentId) {
            const portalToken = crypto.randomBytes(8).toString('hex')
            const [newResident] = await tx
              .insert(residents)
              .values({
                facilityId,
                name: entry.residentName,
                roomNumber: entry.roomNumber ?? null,
                portalToken,
              })
              .returning({ id: residents.id })
            residentId = newResident.id
            createdResidents++
          }

          // Resolve or create service
          let serviceId = entry.serviceId
          if (!serviceId) {
            const [newService] = await tx
              .insert(services)
              .values({
                facilityId,
                name: entry.serviceName,
                priceCents: entry.priceCents ?? 0,
                durationMinutes: 30,
              })
              .returning({ id: services.id })
            serviceId = newService.id
            createdServices++
          }

          // Space bookings 30 min apart from 09:00 UTC
          const startTime = new Date(`${sheet.date}T09:00:00.000Z`)
          startTime.setMinutes(startTime.getMinutes() + entryIndex * 30)
          const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

          await tx.insert(bookings).values({
            facilityId,
            residentId,
            stylistId: sheet.stylistId,
            serviceId,
            startTime,
            endTime,
            priceCents: entry.priceCents ?? null,
            notes: entry.notes ?? null,
            status: 'completed',
            paymentStatus: 'unpaid',
          })
          createdBookings++
          entryIndex++
        }
      }
    })

    return Response.json({
      data: { created: { residents: createdResidents, services: createdServices, bookings: createdBookings } },
    })
  } catch (err) {
    console.error('POST /api/log/ocr/import error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
