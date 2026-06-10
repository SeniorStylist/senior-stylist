import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  facilities,
  stylists,
  stylistFacilityAssignments,
  services,
  residents,
  bookings,
  importBatches,
} from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fuzzyBestMatch, normalizeWords } from '@/lib/fuzzy'
import {
  matchService,
  facilityDateAt9amPlusSlot,
  type ServiceMatch,
} from '@/lib/service-log-import'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

const rowSchema = z.object({
  serviceDate: z.string().min(1),
  clientName: z.string().min(1).max(200),
  room: z.string().max(50).nullable(),
  servicesPerformed: z.string().max(500),
  amountCents: z.number().int().min(1).max(10_000_000),
  notes: z.string().max(2000).nullable(),
  tipsCents: z.number().int().min(0).max(10_000_000).nullable(),
  paymentType: z.string().max(100).nullable(),
  stylistCode: z.string().max(20).nullable(),
  stylistName: z.string().max(200),
})

const bodySchema = z.object({
  facilityCode: z.string().regex(/^F\d{2,5}$/),
  facilityName: z.string().min(1).max(200),
  paymentTypeHint: z.enum(['rfms', 'ip']),
  fileName: z.string().max(300).optional(),
  rows: z.array(rowSchema).min(1).max(5000),
  // Optional operator override for facility-conflict resolution. When absent,
  // falls back to create-or-reuse-by-code (the original behavior).
  resolution: z
    .object({
      mode: z.enum(['create', 'reuse', 'skip']),
      facilityId: z.string().uuid().optional(),
      renameTo: z.string().min(1).max(200).optional(),
      adoptCode: z.boolean().optional(),
    })
    .optional(),
})

interface FacilityImportResult {
  facilityCode: string
  facilityName: string
  facilityCreated: boolean
  reusedExisting: boolean
  skipped: boolean
  stylistsCreated: number
  residentsUpserted: number
  bookingsCreated: number
  duplicatesSkipped: number
  servicesMatched: number
  unresolvedCount: number
  rowsSkipped: number
}

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('multiLogImport', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsedBody = bodySchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return Response.json({ error: parsedBody.error.flatten() }, { status: 422 })
    }
    const { facilityCode, facilityName, paymentTypeHint, fileName, rows, resolution } = parsedBody.data

    const result: FacilityImportResult = {
      facilityCode,
      facilityName,
      facilityCreated: false,
      reusedExisting: false,
      skipped: false,
      stylistsCreated: 0,
      residentsUpserted: 0,
      bookingsCreated: 0,
      duplicatesSkipped: 0,
      servicesMatched: 0,
      unresolvedCount: 0,
      rowsSkipped: 0,
    }

    // 0. Operator chose to skip this facility entirely.
    if (resolution?.mode === 'skip') {
      result.skipped = true
      return Response.json({ data: result })
    }

    // 1. Resolve the target facility.
    let facility: { id: string; name: string; timezone: string | null } | undefined
    if (resolution?.mode === 'reuse' && resolution.facilityId) {
      // Import into an explicitly chosen existing facility (merge / adopt-duplicate).
      const target = await db.query.facilities.findFirst({
        where: eq(facilities.id, resolution.facilityId),
        columns: { id: true, name: true, timezone: true, facilityCode: true },
      })
      if (!target) {
        return Response.json({ error: 'Chosen facility no longer exists' }, { status: 404 })
      }
      const updates: Partial<typeof facilities.$inferInsert> = {}
      if (resolution.renameTo && resolution.renameTo !== target.name) {
        updates.name = resolution.renameTo
      }
      // Adopt the sheet's F-code onto a facility that has none — but only if the
      // code isn't already taken by a different facility.
      if (resolution.adoptCode && !target.facilityCode) {
        const codeTaken = await db.query.facilities.findFirst({
          where: eq(facilities.facilityCode, facilityCode),
          columns: { id: true },
        })
        if (!codeTaken) updates.facilityCode = facilityCode
      }
      if (Object.keys(updates).length > 0) {
        await db.update(facilities).set(updates).where(eq(facilities.id, target.id))
      }
      facility = { id: target.id, name: updates.name ?? target.name, timezone: target.timezone }
      result.reusedExisting = true
    } else {
      // Default: resolve by code — create if missing.
      const existing = await db.query.facilities.findFirst({
        where: eq(facilities.facilityCode, facilityCode),
        columns: { id: true, name: true, timezone: true },
      })
      if (existing) {
        facility = existing
        result.reusedExisting = true
      } else {
        const [created] = await db
          .insert(facilities)
          .values({ name: facilityName, facilityCode, paymentType: paymentTypeHint })
          .returning({ id: facilities.id, name: facilities.name, timezone: facilities.timezone })
        facility = created
        result.facilityCreated = true
      }
    }
    const facilityId = facility.id
    const tz = facility.timezone ?? 'America/New_York'

    // 2. Resolve stylists by code — create + assign any missing.
    const stylistByCode = new Map<string, string>() // code → stylistId
    const distinctStylistCodes = new Map<string, string>() // code → name (first seen)
    for (const r of rows) {
      if (r.stylistCode && !distinctStylistCodes.has(r.stylistCode)) {
        distinctStylistCodes.set(r.stylistCode, r.stylistName)
      }
    }
    for (const [code, name] of distinctStylistCodes) {
      const existing = await db.query.stylists.findFirst({
        where: eq(stylists.stylistCode, code),
        columns: { id: true },
      })
      let stylistId: string
      if (existing) {
        stylistId = existing.id
      } else {
        const [createdStylist] = await db
          .insert(stylists)
          .values({ name, stylistCode: code, facilityId })
          .returning({ id: stylists.id })
        stylistId = createdStylist.id
        result.stylistsCreated += 1
      }
      stylistByCode.set(code, stylistId)
      // Ensure a facility assignment exists (idempotent via unique constraint).
      await db
        .insert(stylistFacilityAssignments)
        .values({ stylistId, facilityId, active: true })
        .onConflictDoNothing()
    }

    // 3. Resident upsert — fuzzy match within facility at 0.85, create otherwise.
    const facilityResidents = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
      columns: { id: true, name: true, roomNumber: true },
    })
    const residentMap = new Map<string, string>() // normalized name → residentId
    const uniqClients = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      const key = normalizeWords(row.clientName).join(' ')
      if (!key || uniqClients.has(key)) continue
      uniqClients.set(key, row)
    }
    for (const [key, row] of uniqClients) {
      const hit = fuzzyBestMatch(facilityResidents, row.clientName, 0.85)
      if (hit) {
        residentMap.set(key, hit.id)
        continue
      }
      const [inserted] = await db
        .insert(residents)
        .values({ facilityId, name: row.clientName, roomNumber: row.room, active: true })
        .returning({ id: residents.id, name: residents.name })
      residentMap.set(key, inserted.id)
      facilityResidents.push({ id: inserted.id, name: inserted.name, roomNumber: row.room })
      result.residentsUpserted += 1
    }

    // 4. Service-match cache (no service creation — historical records link by name/price only).
    const facilityServices = await db.query.services.findMany({
      where: eq(services.facilityId, facilityId),
      columns: { id: true, name: true, priceCents: true, pricingType: true, active: true },
    })
    const serviceMatchCache = new Map<string, ServiceMatch>()
    const getMatch = (rawName: string, amountCents: number): ServiceMatch => {
      const cacheKey = `${rawName}|${amountCents}`
      const cached = serviceMatchCache.get(cacheKey)
      if (cached) return cached
      const m = matchService(rawName, amountCents, facilityServices)
      serviceMatchCache.set(cacheKey, m)
      return m
    }

    // 5. Insert batch + bookings in one transaction.
    await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({
          facilityId,
          stylistId: null, // multi-stylist sheet — no single stylist owner
          uploadedBy: user.id,
          fileName: fileName ?? `Multi-facility log — ${facilityCode}`,
          sourceType: 'multi_service_log',
          rowCount: rows.length,
          matchedCount: 0,
          unresolvedCount: 0,
        })
        .returning({ id: importBatches.id })

      // Dedup against existing active bookings in this facility's date window.
      const dateMs = rows.map((r) => new Date(r.serviceDate).getTime())
      const minDate = new Date(Math.min(...dateMs))
      const maxDate = new Date(Math.max(...dateMs))
      const existingBookings = await tx.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.active, true),
          sql`${bookings.startTime} >= ${new Date(minDate.getTime() - 86_400_000).toISOString()}`,
          sql`${bookings.startTime} <= ${new Date(maxDate.getTime() + 86_400_000).toISOString()}`,
        ),
        columns: { residentId: true, startTime: true, rawServiceName: true, source: true },
      })
      const dedupSet = new Set<string>()
      const existingScheduledMap = new Map<string, Date>() // residentId|date → earliest scheduled start
      for (const b of existingBookings) {
        const t = b.startTime instanceof Date ? b.startTime : new Date(b.startTime)
        const dateStr = t.toISOString().slice(0, 10)
        dedupSet.add(`${b.residentId}|${dateStr}|${b.rawServiceName ?? ''}`)
        if (b.source === 'scheduled') {
          const key = `${b.residentId}|${dateStr}`
          const cur = existingScheduledMap.get(key)
          if (!cur || t < cur) existingScheduledMap.set(key, t)
        }
      }
      const slotCountMap = new Map<string, number>() // date → next 9am+slot index

      type InsertRow = typeof bookings.$inferInsert
      const toInsert: InsertRow[] = []

      for (const row of rows) {
        const key = normalizeWords(row.clientName).join(' ')
        const residentId = residentMap.get(key)
        if (!residentId) { result.rowsSkipped += 1; continue }
        const stylistId = row.stylistCode ? stylistByCode.get(row.stylistCode) : undefined
        if (!stylistId) { result.rowsSkipped += 1; continue } // booking.stylistId is NOT NULL

        const serviceDate = new Date(row.serviceDate)
        const dateStr = serviceDate.toISOString().slice(0, 10)
        const scheduleKey = `${residentId}|${dateStr}`
        const existingStart = existingScheduledMap.get(scheduleKey)
        let start: Date
        if (existingStart) {
          start = existingStart
        } else {
          const slotIndex = slotCountMap.get(dateStr) ?? 0
          slotCountMap.set(dateStr, slotIndex + 1)
          start = facilityDateAt9amPlusSlot(serviceDate, tz, slotIndex)
        }
        const end = new Date(start.getTime() + 30 * 60_000)

        const dedupKey = `${residentId}|${start.toISOString().slice(0, 10)}|${row.servicesPerformed}`
        if (dedupSet.has(dedupKey)) { result.duplicatesSkipped += 1; continue }
        dedupSet.add(dedupKey)

        const match = getMatch(row.servicesPerformed, row.amountCents)
        if (match.serviceIds.length > 0) result.servicesMatched += 1
        if (match.needsReview) result.unresolvedCount += 1

        toInsert.push({
          facilityId,
          residentId,
          stylistId,
          serviceId: match.serviceIds[0] ?? null,
          serviceIds: match.serviceIds.length > 0 ? match.serviceIds : null,
          rawServiceName: row.servicesPerformed,
          startTime: start,
          endTime: end,
          priceCents: row.amountCents,
          notes: row.notes,
          status: 'completed',
          paymentStatus: 'unpaid',
          source: 'historical_import',
          importBatchId: batch.id,
          needsReview: match.needsReview,
          tipCents: row.tipsCents ?? null,
        })
      }

      for (let i = 0; i < toInsert.length; i += 100) {
        await tx.insert(bookings).values(toInsert.slice(i, i + 100))
      }
      result.bookingsCreated = toInsert.length

      await tx
        .update(importBatches)
        .set({ matchedCount: result.servicesMatched, unresolvedCount: result.unresolvedCount })
        .where(eq(importBatches.id, batch.id))
    })

    if (result.facilityCreated || result.reusedExisting || result.stylistsCreated > 0) revalidateTag('facilities', {})
    revalidateTag('bookings', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('[import-multi-log] error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 },
    )
  }
}
