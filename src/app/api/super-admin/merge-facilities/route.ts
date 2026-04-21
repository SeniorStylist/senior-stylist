import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  facilities,
  residents,
  bookings,
  logEntries,
  stylistFacilityAssignments,
  stylistAvailability,
  facilityUsers,
  qbInvoices,
  qbPayments,
  qbUnresolvedPayments,
  services,
  stylists,
  invites,
  accessRequests,
  coverageRequests,
  complianceDocuments,
  scanCorrections,
  payPeriods,
  stylistPayItems,
  oauthStates,
  franchiseFacilities,
  facilityMergeLog,
} from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { normalizeWords } from '@/lib/fuzzy'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const inputSchema = z
  .object({
    primaryFacilityId: z.string().uuid(),
    secondaryFacilityId: z.string().uuid(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => v.primaryFacilityId !== v.secondaryFacilityId, {
    message: 'Primary and secondary must be different facilities',
  })

const INHERIT_FIELDS = [
  'address',
  'phone',
  'contactEmail',
  'calendarId',
  'qbRealmId',
  'qbAccessToken',
  'qbRefreshToken',
  'qbTokenExpiresAt',
  'qbExpenseAccountId',
  'qbCustomerId',
  'workingHours',
  'stripePublishableKey',
  'stripeSecretKey',
  'revSharePercentage',
  'serviceCategoryOrder',
] as const

function residentKey(name: string, roomNumber: string | null): string {
  const nameKey = normalizeWords(name).join(' ')
  const room = (roomNumber ?? '').trim().toLowerCase()
  return `${nameKey}|${room}`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }
  const { primaryFacilityId, secondaryFacilityId, notes } = parsed.data

  try {
    const result = await db.transaction(async (tx) => {
      const [primary] = await tx.select().from(facilities).where(eq(facilities.id, primaryFacilityId))
      const [secondary] = await tx.select().from(facilities).where(eq(facilities.id, secondaryFacilityId))
      if (!primary) throw new Error('Primary facility not found')
      if (!secondary) throw new Error('Secondary facility not found')

      // 2. RESIDENTS — conflict-aware re-point
      const secResidents = await tx
        .select({ id: residents.id, name: residents.name, roomNumber: residents.roomNumber })
        .from(residents)
        .where(eq(residents.facilityId, secondaryFacilityId))
      const primResidents = await tx
        .select({ id: residents.id, name: residents.name, roomNumber: residents.roomNumber })
        .from(residents)
        .where(eq(residents.facilityId, primaryFacilityId))

      const primKey = new Map(primResidents.map((r) => [residentKey(r.name, r.roomNumber), r.id]))
      const remap = new Map<string, string>()
      let residentsTransferred = 0
      let residentsConflicted = 0

      for (const sr of secResidents) {
        const matchId = primKey.get(residentKey(sr.name, sr.roomNumber))
        if (matchId) {
          remap.set(sr.id, matchId)
          residentsConflicted++
        } else {
          await tx.update(residents).set({ facilityId: primaryFacilityId }).where(eq(residents.id, sr.id))
          residentsTransferred++
        }
      }

      // 2a. Re-point resident_id refs for conflicted residents
      for (const [oldId, newId] of remap) {
        await tx.update(bookings).set({ residentId: newId }).where(eq(bookings.residentId, oldId))
        await tx.update(qbInvoices).set({ residentId: newId }).where(eq(qbInvoices.residentId, oldId))
        await tx.update(qbPayments).set({ residentId: newId }).where(eq(qbPayments.residentId, oldId))
        await tx
          .update(qbUnresolvedPayments)
          .set({ resolvedToResidentId: newId })
          .where(eq(qbUnresolvedPayments.resolvedToResidentId, oldId))
      }
      if (remap.size > 0) {
        await tx.update(residents).set({ active: false }).where(inArray(residents.id, [...remap.keys()]))
      }

      // 3. BOOKINGS — bulk update
      const bRes = await tx
        .update(bookings)
        .set({ facilityId: primaryFacilityId })
        .where(eq(bookings.facilityId, secondaryFacilityId))
        .returning({ id: bookings.id })
      const bookingsTransferred = bRes.length

      // 4. LOG_ENTRIES — unique-aware (facility_id, stylist_id, date)
      const secLogs = await tx
        .select({ id: logEntries.id, stylistId: logEntries.stylistId, date: logEntries.date })
        .from(logEntries)
        .where(eq(logEntries.facilityId, secondaryFacilityId))
      const primLogs = await tx
        .select({ stylistId: logEntries.stylistId, date: logEntries.date })
        .from(logEntries)
        .where(eq(logEntries.facilityId, primaryFacilityId))
      const primLogKeys = new Set(primLogs.map((r) => `${r.stylistId}|${r.date}`))
      let logEntriesTransferred = 0
      let logEntriesDropped = 0
      for (const log of secLogs) {
        if (primLogKeys.has(`${log.stylistId}|${log.date}`)) {
          await tx.delete(logEntries).where(eq(logEntries.id, log.id))
          logEntriesDropped++
        } else {
          await tx.update(logEntries).set({ facilityId: primaryFacilityId }).where(eq(logEntries.id, log.id))
          logEntriesTransferred++
        }
      }

      // 5. STYLIST_FACILITY_ASSIGNMENTS — unique on (stylist_id, facility_id)
      const secAssigns = await tx
        .select({ id: stylistFacilityAssignments.id, stylistId: stylistFacilityAssignments.stylistId })
        .from(stylistFacilityAssignments)
        .where(eq(stylistFacilityAssignments.facilityId, secondaryFacilityId))
      const primAssigns = await tx
        .select({ stylistId: stylistFacilityAssignments.stylistId })
        .from(stylistFacilityAssignments)
        .where(eq(stylistFacilityAssignments.facilityId, primaryFacilityId))
      const primAssignSet = new Set(primAssigns.map((r) => r.stylistId))
      let stylistAssignmentsTransferred = 0
      let stylistAssignmentsDropped = 0
      for (const a of secAssigns) {
        if (primAssignSet.has(a.stylistId)) {
          await tx.delete(stylistFacilityAssignments).where(eq(stylistFacilityAssignments.id, a.id))
          stylistAssignmentsDropped++
        } else {
          await tx
            .update(stylistFacilityAssignments)
            .set({ facilityId: primaryFacilityId })
            .where(eq(stylistFacilityAssignments.id, a.id))
          stylistAssignmentsTransferred++
        }
      }

      // 6. STYLIST_AVAILABILITY — unique on (stylist_id, facility_id, day_of_week)
      const secAvail = await tx
        .select({ id: stylistAvailability.id, stylistId: stylistAvailability.stylistId, dayOfWeek: stylistAvailability.dayOfWeek })
        .from(stylistAvailability)
        .where(eq(stylistAvailability.facilityId, secondaryFacilityId))
      const primAvail = await tx
        .select({ stylistId: stylistAvailability.stylistId, dayOfWeek: stylistAvailability.dayOfWeek })
        .from(stylistAvailability)
        .where(eq(stylistAvailability.facilityId, primaryFacilityId))
      const primAvailKeys = new Set(primAvail.map((r) => `${r.stylistId}|${r.dayOfWeek}`))
      for (const av of secAvail) {
        if (primAvailKeys.has(`${av.stylistId}|${av.dayOfWeek}`)) {
          await tx.delete(stylistAvailability).where(eq(stylistAvailability.id, av.id))
        } else {
          await tx.update(stylistAvailability).set({ facilityId: primaryFacilityId }).where(eq(stylistAvailability.id, av.id))
        }
      }

      // 7. FACILITY_USERS — PK conflict-aware on (user_id, facility_id)
      const secUsers = await tx
        .select({ userId: facilityUsers.userId })
        .from(facilityUsers)
        .where(eq(facilityUsers.facilityId, secondaryFacilityId))
      const primUsers = await tx
        .select({ userId: facilityUsers.userId })
        .from(facilityUsers)
        .where(eq(facilityUsers.facilityId, primaryFacilityId))
      const primUserSet = new Set(primUsers.map((r) => r.userId))
      for (const fu of secUsers) {
        if (primUserSet.has(fu.userId)) {
          await tx
            .delete(facilityUsers)
            .where(and(eq(facilityUsers.userId, fu.userId), eq(facilityUsers.facilityId, secondaryFacilityId)))
        } else {
          await tx
            .update(facilityUsers)
            .set({ facilityId: primaryFacilityId })
            .where(and(eq(facilityUsers.userId, fu.userId), eq(facilityUsers.facilityId, secondaryFacilityId)))
        }
      }

      // 8. QB_INVOICES — unique on (invoice_num, facility_id)
      const secInvoices = await tx
        .select({ id: qbInvoices.id, invoiceNum: qbInvoices.invoiceNum })
        .from(qbInvoices)
        .where(eq(qbInvoices.facilityId, secondaryFacilityId))
      const primInvoices = await tx
        .select({ invoiceNum: qbInvoices.invoiceNum })
        .from(qbInvoices)
        .where(eq(qbInvoices.facilityId, primaryFacilityId))
      const primInvoiceNums = new Set(primInvoices.map((r) => r.invoiceNum))
      let qbInvoicesTransferred = 0
      let qbInvoicesDropped = 0
      for (const inv of secInvoices) {
        if (primInvoiceNums.has(inv.invoiceNum)) {
          await tx.delete(qbInvoices).where(eq(qbInvoices.id, inv.id))
          qbInvoicesDropped++
        } else {
          await tx.update(qbInvoices).set({ facilityId: primaryFacilityId }).where(eq(qbInvoices.id, inv.id))
          qbInvoicesTransferred++
        }
      }

      // 9. Simple bulk updates (no unique conflicts)
      const qbPaymentsRes = await tx
        .update(qbPayments)
        .set({ facilityId: primaryFacilityId })
        .where(eq(qbPayments.facilityId, secondaryFacilityId))
        .returning({ id: qbPayments.id })
      await tx
        .update(qbUnresolvedPayments)
        .set({ facilityId: primaryFacilityId })
        .where(eq(qbUnresolvedPayments.facilityId, secondaryFacilityId))
      await tx.update(services).set({ facilityId: primaryFacilityId }).where(eq(services.facilityId, secondaryFacilityId))
      await tx.update(stylists).set({ facilityId: primaryFacilityId }).where(eq(stylists.facilityId, secondaryFacilityId))
      await tx.update(invites).set({ facilityId: primaryFacilityId }).where(eq(invites.facilityId, secondaryFacilityId))
      await tx.update(accessRequests).set({ facilityId: primaryFacilityId }).where(eq(accessRequests.facilityId, secondaryFacilityId))
      await tx
        .update(coverageRequests)
        .set({ facilityId: primaryFacilityId })
        .where(eq(coverageRequests.facilityId, secondaryFacilityId))
      await tx
        .update(complianceDocuments)
        .set({ facilityId: primaryFacilityId })
        .where(eq(complianceDocuments.facilityId, secondaryFacilityId))
      await tx
        .update(scanCorrections)
        .set({ facilityId: primaryFacilityId })
        .where(eq(scanCorrections.facilityId, secondaryFacilityId))
      await tx.update(payPeriods).set({ facilityId: primaryFacilityId }).where(eq(payPeriods.facilityId, secondaryFacilityId))
      await tx
        .update(stylistPayItems)
        .set({ facilityId: primaryFacilityId })
        .where(eq(stylistPayItems.facilityId, secondaryFacilityId))
      await tx.update(oauthStates).set({ facilityId: primaryFacilityId }).where(eq(oauthStates.facilityId, secondaryFacilityId))

      // 10. franchise_facilities — delete secondary's rows (primary keeps its own memberships)
      await tx.delete(franchiseFacilities).where(eq(franchiseFacilities.facilityId, secondaryFacilityId))

      // 11. Field inheritance — copy secondary → primary only when primary is null
      const patch: Record<string, unknown> = {}
      const fieldsInherited: string[] = []
      for (const f of INHERIT_FIELDS) {
        const primaryVal = (primary as Record<string, unknown>)[f]
        const secondaryVal = (secondary as Record<string, unknown>)[f]
        if (primaryVal == null && secondaryVal != null) {
          patch[f] = secondaryVal
          fieldsInherited.push(f)
        }
      }
      if (Object.keys(patch).length > 0) {
        await tx.update(facilities).set({ ...patch, updatedAt: new Date() }).where(eq(facilities.id, primaryFacilityId))
      }

      // 12. Deactivate secondary
      await tx
        .update(facilities)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(facilities.id, secondaryFacilityId))

      // 13. Audit log insert
      await tx.insert(facilityMergeLog).values({
        performedBy: user.id,
        primaryFacilityId,
        secondaryFacilityId,
        secondaryFacilityName: secondary.name,
        residentsTransferred,
        residentsConflicted,
        bookingsTransferred,
        logEntriesTransferred,
        logEntriesDropped,
        stylistAssignmentsTransferred,
        stylistAssignmentsDropped,
        qbInvoicesTransferred,
        qbInvoicesDropped,
        qbPaymentsTransferred: qbPaymentsRes.length,
        fieldsInherited,
        notes: notes ?? null,
      })

      return {
        secondaryFacilityName: secondary.name,
        residentsTransferred,
        residentsConflicted,
        bookingsTransferred,
        logEntriesTransferred,
        logEntriesDropped,
        stylistAssignmentsTransferred,
        stylistAssignmentsDropped,
        qbInvoicesTransferred,
        qbInvoicesDropped,
        qbPaymentsTransferred: qbPaymentsRes.length,
        fieldsInherited,
      }
    })

    return Response.json({ data: result })
  } catch (err) {
    return Response.json(
      { error: `Merge failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
