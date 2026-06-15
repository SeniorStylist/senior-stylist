import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, services, bookings, stylists, stylistFacilityAssignments, franchiseFacilities } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { generateStylistCode } from '@/lib/stylist-code'
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
    z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        // Either an existing stylist (id) OR a name to match-or-create. The sheet
        // header names the stylist; for a newly-onboarded facility there may be no
        // stylist record yet, so we accept a name and create one on import.
        stylistId: z.string().uuid().nullable(),
        stylistName: z.string().max(200).optional().default(''),
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
      .refine((s) => !!s.stylistId || s.stylistName.trim().length > 0, {
        message: 'Each sheet needs a stylist — select an existing one or provide a name to create.',
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
    if (!isMasterAdmin && !canScanLogs(facilityUser.role)) {
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
    let createdStylists = 0
    let createdBookings = 0

    // Franchise for any stylists we create (mirrors POST /api/stylists so an
    // import-created stylist is a first-class member of the franchise pool).
    const ff = await db.query.franchiseFacilities.findFirst({
      where: eq(franchiseFacilities.facilityId, facilityId),
      columns: { franchiseId: true },
    })
    const franchiseId = ff?.franchiseId ?? null

    // Load existing active records for fuzzy matching — done once before the transaction
    const existingServices = await db
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(and(eq(services.facilityId, facilityId), eq(services.active, true)))

    const existingResidents = await db
      .select({ id: residents.id, name: residents.name })
      .from(residents)
      .where(and(eq(residents.facilityId, facilityId), eq(residents.active, true)))

    const existingStylists = await db
      .select({ id: stylists.id, name: stylists.name })
      .from(stylists)
      .where(and(eq(stylists.facilityId, facilityId), eq(stylists.active, true)))

    // Stylist ids the caller may attach bookings to: facility-owned + active
    // assignments to this facility. Guards against attaching a booking to a
    // stylist from another facility via a forged id (IDOR).
    const assignmentRows = await db
      .select({ id: stylistFacilityAssignments.stylistId })
      .from(stylistFacilityAssignments)
      .where(and(eq(stylistFacilityAssignments.facilityId, facilityId), eq(stylistFacilityAssignments.active, true)))
    const validStylistIds = new Set<string>([
      ...existingStylists.map((s) => s.id),
      ...assignmentRows.map((r) => r.id),
    ])
    for (const sheet of parsed.data.sheets) {
      if (sheet.stylistId && !validStylistIds.has(sheet.stylistId)) {
        return Response.json({ error: 'A sheet references a stylist outside your facility.' }, { status: 403 })
      }
    }

    // In-memory dedup maps — prevent duplicate inserts within a single import
    const residentMap = new Map<string, string>()
    const serviceMap = new Map<string, string>()
    const stylistMap = new Map<string, string>() // lowercased new-stylist name → id

    await db.transaction(async (tx) => {
      for (const sheet of parsed.data.sheets) {
        // Resolve the stylist for this sheet: chosen id → in-memory map →
        // fuzzy DB match → create. Mirrors the resident/service resolution below.
        let sheetStylistId = sheet.stylistId
        if (!sheetStylistId) {
          const name = sheet.stylistName.trim()
          const key = name.toLowerCase()
          if (stylistMap.has(key)) {
            sheetStylistId = stylistMap.get(key)!
          } else {
            const dbMatch = existingStylists.find((s) => fuzzyScore(s.name, name) >= 0.8)
            if (dbMatch) {
              sheetStylistId = dbMatch.id
              stylistMap.set(key, dbMatch.id)
            } else {
              const stylistCode = await generateStylistCode(tx)
              const [newStylist] = await tx
                .insert(stylists)
                .values({ name, stylistCode, facilityId, franchiseId })
                .returning({ id: stylists.id })
              await tx
                .insert(stylistFacilityAssignments)
                .values({ stylistId: newStylist.id, facilityId, active: true })
                .onConflictDoNothing()
              sheetStylistId = newStylist.id
              stylistMap.set(key, newStylist.id)
              existingStylists.push({ id: newStylist.id, name })
              createdStylists++
            }
          }
        }

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

          // If user added a room number during review for a matched resident who has none, update it
          if (residentId && entry.roomNumber?.trim()) {
            await tx
              .update(residents)
              .set({ roomNumber: entry.roomNumber.trim() })
              .where(and(eq(residents.id, residentId), isNull(residents.roomNumber)))
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
            stylistId: sheetStylistId,
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
      data: { created: { residents: createdResidents, services: createdServices, stylists: createdStylists, bookings: createdBookings } },
    })
  } catch (err) {
    console.error('POST /api/log/ocr/import error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
