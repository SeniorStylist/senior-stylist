import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  facilities,
  stylists,
  services,
  residents,
  bookings,
  qbInvoices,
  importBatches,
} from '@/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fuzzyBestMatch, fuzzyScore, normalizeWords } from '@/lib/fuzzy'
import {
  parseServiceLogXlsx,
  matchService,
  serviceDateAtNoonInTz,
  splitStylistCell,
  type ParsedServiceLogRow,
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

interface ImportResult {
  batchId: string
  residentsUpserted: number
  bookingsCreated: number
  duplicatesSkipped: number
  servicesMatched: number
  unresolvedCount: number
  qbInvoicesLinked: number
}

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('billingImport', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseServiceLogXlsx(buffer, file.name)
    if (parsed.rows.length === 0) {
      return Response.json({ error: 'No usable rows found in file' }, { status: 400 })
    }

    // 5. Facility match (fuzzy ≥ 0.70)
    const allActiveFacilities = await db.query.facilities.findMany({
      where: eq(facilities.active, true),
      columns: { id: true, name: true, timezone: true },
    })
    const facilityHit = parsed.meta.facility
      ? fuzzyBestMatch(allActiveFacilities, parsed.meta.facility, 0.7)
      : null
    if (!facilityHit) {
      return Response.json(
        { error: 'facility_not_found', facilityName: parsed.meta.facility },
        { status: 400 },
      )
    }
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityHit.id),
      columns: { id: true, name: true, timezone: true },
    })
    if (!facility) {
      return Response.json({ error: 'facility_not_found' }, { status: 400 })
    }

    // 6. Stylist match (facility pool ∪ franchise pool, fuzzy ≥ 0.70)
    const candidateStylists = await db.query.stylists.findMany({
      where: and(eq(stylists.active, true)),
      columns: { id: true, name: true, stylistCode: true, facilityId: true },
    })
    const inFacilityOrFranchise = candidateStylists.filter(
      (s) => s.facilityId === facility.id || s.facilityId === null,
    )
    const stylistHit = parsed.meta.stylist
      ? fuzzyBestMatch(inFacilityOrFranchise, parsed.meta.stylist, 0.7)
      : null
    if (!stylistHit) {
      return Response.json({
        data: {
          stylistResolutionNeeded: true,
          stylistName: parsed.meta.stylist,
          stylistCode: parsed.meta.stylistCode,
          facilityId: facility.id,
        },
      })
    }
    const stylistId = stylistHit.id

    // 7. Resident upsert — collect uniques from file
    const facilityResidents = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, facility.id), eq(residents.active, true)),
      columns: { id: true, name: true, roomNumber: true },
    })

    const residentMap = new Map<string, string>() // normalized name → residentId
    let residentsUpserted = 0

    const uniqClients = new Map<string, ParsedServiceLogRow>() // normalized → first row
    for (const row of parsed.rows) {
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
        .values({
          facilityId: facility.id,
          name: row.clientName,
          roomNumber: row.room,
          active: true,
        })
        .returning({ id: residents.id, name: residents.name })
      residentMap.set(key, inserted.id)
      facilityResidents.push({ id: inserted.id, name: inserted.name, roomNumber: row.room })
      residentsUpserted += 1
    }

    // 8. Service-match cache: "raw|amount" → ServiceMatch
    const facilityServices = await db.query.services.findMany({
      where: eq(services.facilityId, facility.id),
      columns: { id: true, name: true, priceCents: true, pricingType: true, active: true },
    })

    const serviceMatchCache = new Map<string, ServiceMatch>()
    function getMatch(rawName: string, amountCents: number): ServiceMatch {
      const key = `${rawName}|${amountCents}`
      const cached = serviceMatchCache.get(key)
      if (cached) return cached
      const m = matchService(rawName, amountCents, facilityServices)
      serviceMatchCache.set(key, m)
      return m
    }

    // 9. Insert batch + bookings inside a transaction
    const result: ImportResult = {
      batchId: '',
      residentsUpserted,
      bookingsCreated: 0,
      duplicatesSkipped: 0,
      servicesMatched: 0,
      unresolvedCount: 0,
      qbInvoicesLinked: 0,
    }

    await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({
          facilityId: facility.id,
          stylistId,
          uploadedBy: user.id,
          fileName: file.name,
          sourceType: 'service_log',
          rowCount: parsed.rows.length,
          matchedCount: 0,
          unresolvedCount: 0,
        })
        .returning({ id: importBatches.id })
      result.batchId = batch.id

      // Pre-fetch existing bookings for this facility within the parsed date range
      // for fast dedup lookup (key by residentId|serviceDate|rawServiceName).
      const dateValues = parsed.rows.map((r) => r.serviceDate)
      const minDate = new Date(Math.min(...dateValues.map((d) => d.getTime())))
      const maxDate = new Date(Math.max(...dateValues.map((d) => d.getTime())))
      const existingBookings = await tx.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facility.id),
          sql`${bookings.startTime} >= ${new Date(minDate.getTime() - 86_400_000)}`,
          sql`${bookings.startTime} <= ${new Date(maxDate.getTime() + 86_400_000)}`,
        ),
        columns: { id: true, residentId: true, startTime: true, rawServiceName: true },
      })
      const dedupSet = new Set<string>()
      for (const b of existingBookings) {
        const dateStr = (b.startTime instanceof Date ? b.startTime : new Date(b.startTime))
          .toISOString()
          .slice(0, 10)
        dedupSet.add(`${b.residentId}|${dateStr}|${b.rawServiceName ?? ''}`)
      }

      type InsertRow = typeof bookings.$inferInsert
      const toInsert: InsertRow[] = []

      for (const row of parsed.rows) {
        const key = normalizeWords(row.clientName).join(' ')
        const residentId = residentMap.get(key)
        if (!residentId) continue

        const start = serviceDateAtNoonInTz(row.serviceDate, facility.timezone)
        const end = new Date(start.getTime() + 30 * 60_000)
        const dedupKey = `${residentId}|${start.toISOString().slice(0, 10)}|${row.servicesPerformed}`
        if (dedupSet.has(dedupKey)) {
          result.duplicatesSkipped += 1
          continue
        }
        dedupSet.add(dedupKey)

        const match = getMatch(row.servicesPerformed, row.amountCents)
        if (match.serviceIds.length > 0) result.servicesMatched += 1
        if (match.needsReview) result.unresolvedCount += 1

        toInsert.push({
          facilityId: facility.id,
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
        })
      }

      // Bulk insert in chunks of 100. Drizzle's .returning() gives us IDs for QB matching.
      const insertedIds: { id: string; residentId: string; priceCents: number | null }[] = []
      for (let i = 0; i < toInsert.length; i += 100) {
        const chunk = toInsert.slice(i, i + 100)
        const rows = await tx
          .insert(bookings)
          .values(chunk)
          .returning({ id: bookings.id, residentId: bookings.residentId, priceCents: bookings.priceCents })
        insertedIds.push(...rows)
      }
      result.bookingsCreated = insertedIds.length

      // 10. QB invoice cross-reference
      // Group new bookings by priceCents → fetch unmatched QB invoices for those amounts in one go.
      const amounts = Array.from(new Set(insertedIds.map((b) => b.priceCents).filter((p): p is number => p != null)))
      if (amounts.length > 0) {
        const candidateInvoices = await tx.query.qbInvoices.findMany({
          where: and(
            eq(qbInvoices.facilityId, facility.id),
            inArray(qbInvoices.amountCents, amounts),
            isNull(qbInvoices.matchedBookingId),
          ),
          with: { resident: { columns: { id: true, name: true } } },
        })

        // resident name lookup for the new bookings
        const residentNameById = new Map(facilityResidents.map((r) => [r.id, r.name]))

        // Pre-group invoices by amount for fast lookup
        const invoicesByAmount = new Map<number, typeof candidateInvoices>()
        for (const inv of candidateInvoices) {
          const arr = invoicesByAmount.get(inv.amountCents) ?? []
          arr.push(inv)
          invoicesByAmount.set(inv.amountCents, arr)
        }
        // Track which invoices have been claimed within this transaction
        const claimedInvoices = new Set<string>()

        // For each newly inserted booking, try to find the closest-date matching invoice
        const insertedWithStart = new Map<string, Date>()
        for (let i = 0; i < toInsert.length; i++) {
          const id = insertedIds.find(
            (b) => b.residentId === toInsert[i].residentId && b.priceCents === toInsert[i].priceCents,
          )?.id
          if (id) insertedWithStart.set(id, toInsert[i].startTime as Date)
        }

        for (const booking of insertedIds) {
          if (booking.priceCents == null) continue
          const candidates = invoicesByAmount.get(booking.priceCents) ?? []
          if (candidates.length === 0) continue
          const residentName = residentNameById.get(booking.residentId) ?? ''

          let best: { invId: string; invDate: Date; score: number } | null = null
          for (const inv of candidates) {
            if (claimedInvoices.has(inv.id)) continue
            const invName = inv.resident?.name ?? ''
            const score = fuzzyScore(invName, residentName)
            if (score < 0.7) continue
            const invDate = new Date(inv.invoiceDate)
            const bookingDate = insertedWithStart.get(booking.id) ?? new Date()
            const diff = Math.abs(invDate.getTime() - bookingDate.getTime())
            if (!best || diff < Math.abs((best.invDate.getTime() - bookingDate.getTime()))) {
              best = { invId: inv.id, invDate, score }
            }
          }
          if (best) {
            claimedInvoices.add(best.invId)
            await tx
              .update(bookings)
              .set({ qbInvoiceMatchId: best.invId })
              .where(eq(bookings.id, booking.id))
            await tx
              .update(qbInvoices)
              .set({ matchedBookingId: booking.id })
              .where(eq(qbInvoices.id, best.invId))
            result.qbInvoicesLinked += 1
          }
        }
      }

      // 11. Update batch row with final counts
      await tx
        .update(importBatches)
        .set({
          matchedCount: result.servicesMatched,
          unresolvedCount: result.unresolvedCount,
        })
        .where(eq(importBatches.id, batch.id))
    })

    // Bust billing cache (qb_invoices.matched_booking_id changed) + bookings cache
    revalidateTag('billing', {})
    revalidateTag('bookings', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('[import-service-log] error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 },
    )
  }
}
