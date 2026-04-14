import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, services, bookings } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import crypto from 'crypto'

const WORD_EXPANSIONS: Record<string, string> = { w: 'wash', c: 'cut', hl: 'highlight', clr: 'color' }

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => WORD_EXPANSIONS[w] ?? w)
    .sort()
}

function fuzzyScore(a: string, b: string): number {
  const aw = normalizeWords(a)
  const bw = normalizeWords(b)
  if (!aw.length || !bw.length) return 0
  const intersection = aw.filter(w => bw.includes(w))
  return intersection.length / Math.max(aw.length, bw.length)
}

const importSchema = z.object({
  sheets: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      stylistId: z.string().uuid(),
      entries: z.array(
        z.object({
          include: z.boolean(),
          residentId: z.string().uuid().nullable(),
          residentName: z.string().min(1).max(200),
          roomNumber: z.string().max(50).nullable(),
          serviceId: z.string().uuid().nullable(),
          serviceName: z.string().min(1).max(200),
          additionalServiceIds: z.array(z.string().uuid().nullable()).max(20).optional().default([]),
          additionalServiceNames: z.array(z.string().max(200)).max(20).optional().default([]),
          priceCents: z.number().int().min(0).max(10_000_000).nullable(),
          notes: z.string().max(2000).nullable(),
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

    // Load existing active records for fuzzy matching — done once before the transaction
    const existingServices = await db
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(and(eq(services.facilityId, facilityId), eq(services.active, true)))

    const existingResidents = await db
      .select({ id: residents.id, name: residents.name })
      .from(residents)
      .where(and(eq(residents.facilityId, facilityId), eq(residents.active, true)))

    // In-memory dedup maps — prevent duplicate inserts within a single import
    const residentMap = new Map<string, string>()
    const serviceMap = new Map<string, string>()

    await db.transaction(async (tx) => {
      for (const sheet of parsed.data.sheets) {
        const includedEntries = sheet.entries.filter((e) => e.include)
        let entryIndex = 0

        for (const entry of includedEntries) {
          // Resolve or create resident (3-step: provided ID → in-memory map → fuzzy DB match → insert)
          let residentId = entry.residentId
          if (!residentId) {
            const key = entry.residentName.toLowerCase().trim()
            if (residentMap.has(key)) {
              residentId = residentMap.get(key)!
            } else {
              const dbMatch = existingResidents.find(r => fuzzyScore(r.name, entry.residentName) >= 0.8)
              if (dbMatch) {
                residentId = dbMatch.id
                residentMap.set(key, residentId)
              } else {
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
                residentMap.set(key, residentId)
                existingResidents.push({ id: residentId, name: entry.residentName })
                createdResidents++
              }
            }
          }

          // Resolve or create a service by name (shared helper used for primary + additionals)
          const resolveServiceId = async (
            providedId: string | null,
            name: string
          ): Promise<{ id: string; name: string }> => {
            if (providedId) {
              const existing = existingServices.find((s) => s.id === providedId)
              return { id: providedId, name: existing?.name ?? name }
            }
            const key = name.toLowerCase().trim()
            if (serviceMap.has(key)) {
              const id = serviceMap.get(key)!
              const existing = existingServices.find((s) => s.id === id)
              return { id, name: existing?.name ?? name }
            }
            const dbMatch = existingServices.find((s) => fuzzyScore(s.name, name) >= 0.8)
            if (dbMatch) {
              serviceMap.set(key, dbMatch.id)
              return { id: dbMatch.id, name: dbMatch.name }
            }
            const [newService] = await tx
              .insert(services)
              .values({
                facilityId,
                name,
                priceCents: 0,
                durationMinutes: 30,
              })
              .returning({ id: services.id })
            serviceMap.set(key, newService.id)
            existingServices.push({ id: newService.id, name })
            createdServices++
            return { id: newService.id, name }
          }

          // Primary service
          const primary = await resolveServiceId(entry.serviceId, entry.serviceName)

          // Additional services (add-ons treated as additional primary services per plan)
          const additionalNames = entry.additionalServiceNames ?? []
          const additionalIds = entry.additionalServiceIds ?? []
          const resolvedAdditional: { id: string; name: string }[] = []
          for (let i = 0; i < additionalNames.length; i++) {
            const name = (additionalNames[i] ?? '').trim()
            if (!name) continue
            const providedId = additionalIds[i] ?? null
            resolvedAdditional.push(await resolveServiceId(providedId, name))
          }

          const allServiceIds = [primary.id, ...resolvedAdditional.map((s) => s.id)]
          const allServiceNames = [primary.name, ...resolvedAdditional.map((s) => s.name)]

          // Space bookings 30 min apart from 09:00 UTC
          const startTime = new Date(`${sheet.date}T09:00:00.000Z`)
          startTime.setMinutes(startTime.getMinutes() + entryIndex * 30)
          const totalDurationMinutes = allServiceIds.length * 30
          const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000)

          await tx.insert(bookings).values({
            facilityId,
            residentId,
            stylistId: sheet.stylistId,
            serviceId: primary.id,
            serviceIds: allServiceIds,
            serviceNames: allServiceNames,
            totalDurationMinutes,
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
