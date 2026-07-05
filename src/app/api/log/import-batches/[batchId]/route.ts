import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'
import { db } from '@/db'
import { bookings, importBatches, facilities, residents, services } from '@/db/schema'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

async function findAuthorizedBatch(
  batchId: string,
  userId: string,
  isMasterAdmin: boolean,
  facilityUser: { facilityId: string; role: string },
) {
  const batch = await db.query.importBatches.findFirst({
    where: and(eq(importBatches.id, batchId), isNull(importBatches.deletedAt)),
    columns: { id: true, facilityId: true, uploadedBy: true },
  })
  if (!batch) return null
  if (isMasterAdmin) return batch
  // Bookkeepers can manage their own uploads regardless of facility
  if (facilityUser.role === 'bookkeeper' && batch.uploadedBy === userId) return batch
  // Admins can manage any batch for their facility
  if (canScanLogs(facilityUser.role) && batch.facilityId === facilityUser.facilityId) return batch
  return null
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const isMasterAdmin = !!(
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    )
    if (!isMasterAdmin && !canScanLogs(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { batchId } = await params
    const batch = await findAuthorizedBatch(batchId, user.id, isMasterAdmin, facilityUser)
    if (!batch) return Response.json({ error: 'Batch not found or access denied' }, { status: 404 })

    let bookingsDeactivated = 0
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(bookings)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(bookings.importBatchId, batchId), eq(bookings.active, true)))
        .returning({ id: bookings.id })
      bookingsDeactivated = updated.length

      await tx
        .update(importBatches)
        .set({ deletedAt: sql`now()` })
        .where(eq(importBatches.id, batchId))
    })

    revalidateTag('bookings', {})
    revalidateTag('billing', {})

    return Response.json({ data: { ok: true, bookingsDeactivated } })
  } catch (err) {
    console.error('[DELETE /api/log/import-batches/:id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const putSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), targetFacilityId: z.string().uuid() }),
  z.object({ action: z.literal('rename'), name: z.string().min(1).max(200) }),
])

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const isMasterAdmin = !!(
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    )
    if (!isMasterAdmin && !canScanLogs(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { batchId } = await params

    // For PUT, we need to find the batch even if deleted (rename/move applies to active batches only)
    const batch = await findAuthorizedBatch(batchId, user.id, isMasterAdmin, facilityUser)
    if (!batch) return Response.json({ error: 'Batch not found or access denied' }, { status: 404 })

    const body = await request.json()
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request' }, { status: 422 })
    }

    if (parsed.data.action === 'move') {
      // Only bookkeepers and master admins have cross-facility access
      if (!isMasterAdmin && facilityUser.role !== 'bookkeeper') {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      const { targetFacilityId } = parsed.data
      const target = await db.query.facilities.findFirst({
        where: and(eq(facilities.id, targetFacilityId), eq(facilities.active, true)),
        columns: { id: true, name: true },
      })
      if (!target) return Response.json({ error: 'Target facility not found' }, { status: 404 })

      // Moving a batch must ALSO re-point each booking's resident + services to
      // records in the target facility — flipping only bookings.facility_id leaves
      // bookings referencing residents/services that live in the source facility,
      // which breaks facility scoping everywhere (daily log, billing, exports).
      await db.transaction(async (tx) => {
        const batchBookings = await tx
          .select({
            id: bookings.id,
            residentId: bookings.residentId,
            serviceId: bookings.serviceId,
            serviceIds: bookings.serviceIds,
          })
          .from(bookings)
          .where(eq(bookings.importBatchId, batchId))

        // ── Residents: match in target (fuzzy ≥ 0.8) → move the row if this batch
        // is its only usage → otherwise clone into the target facility.
        const residentIds = [
          ...new Set(batchBookings.map((b) => b.residentId).filter((id): id is string => !!id)),
        ]
        const sourceResidents = residentIds.length
          ? await tx
              .select({ id: residents.id, name: residents.name, roomNumber: residents.roomNumber })
              .from(residents)
              .where(inArray(residents.id, residentIds))
          : []
        const targetResidents = await tx
          .select({ id: residents.id, name: residents.name })
          .from(residents)
          .where(and(eq(residents.facilityId, targetFacilityId), eq(residents.active, true)))

        const residentIdMap = new Map<string, string>()
        for (const r of sourceResidents) {
          const match = fuzzyBestMatch(targetResidents, r.name, 0.8)
          if (match) {
            residentIdMap.set(r.id, match.id)
            continue
          }
          // Any active bookings OUTSIDE this batch? Then the resident genuinely
          // belongs to the source facility — clone instead of moving.
          const usedElsewhere = await tx
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.residentId, r.id),
                eq(bookings.active, true),
                or(isNull(bookings.importBatchId), ne(bookings.importBatchId, batchId)),
              ),
            )
            .limit(1)
          if (usedElsewhere.length === 0) {
            await tx
              .update(residents)
              .set({ facilityId: targetFacilityId })
              .where(eq(residents.id, r.id))
            residentIdMap.set(r.id, r.id)
          } else {
            const [created] = await tx
              .insert(residents)
              .values({
                facilityId: targetFacilityId,
                name: r.name,
                roomNumber: r.roomNumber,
                portalToken: crypto.randomBytes(8).toString('hex'),
              })
              .returning({ id: residents.id })
            residentIdMap.set(r.id, created.id)
          }
        }

        // ── Services: find-or-create by name in the target facility. Never move a
        // service row — other source-facility bookings may reference it.
        const serviceIdSet = new Set<string>()
        for (const b of batchBookings) {
          if (b.serviceId) serviceIdSet.add(b.serviceId)
          for (const id of b.serviceIds ?? []) if (id) serviceIdSet.add(id)
        }
        const sourceServices = serviceIdSet.size
          ? await tx
              .select({
                id: services.id,
                name: services.name,
                priceCents: services.priceCents,
                durationMinutes: services.durationMinutes,
              })
              .from(services)
              .where(inArray(services.id, [...serviceIdSet]))
          : []
        const targetServices = await tx
          .select({ id: services.id, name: services.name })
          .from(services)
          .where(and(eq(services.facilityId, targetFacilityId), eq(services.active, true)))

        const serviceIdMap = new Map<string, string>()
        for (const s of sourceServices) {
          const match = fuzzyBestMatch(targetServices, s.name, 0.8)
          if (match) {
            serviceIdMap.set(s.id, match.id)
            continue
          }
          const [created] = await tx
            .insert(services)
            .values({
              facilityId: targetFacilityId,
              name: s.name,
              priceCents: s.priceCents,
              durationMinutes: s.durationMinutes ?? 30,
              source: 'ocr_import', // ad-hoc logging service — hidden from families/staff
            })
            .returning({ id: services.id })
          serviceIdMap.set(s.id, created.id)
          targetServices.push({ id: created.id, name: s.name })
        }

        // ── Re-point every booking in the batch.
        for (const b of batchBookings) {
          await tx
            .update(bookings)
            .set({
              facilityId: targetFacilityId,
              residentId: b.residentId ? (residentIdMap.get(b.residentId) ?? b.residentId) : b.residentId,
              serviceId: b.serviceId ? (serviceIdMap.get(b.serviceId) ?? b.serviceId) : b.serviceId,
              serviceIds: (b.serviceIds ?? []).map((id) => (id ? (serviceIdMap.get(id) ?? id) : id)),
              updatedAt: new Date(),
            })
            .where(eq(bookings.id, b.id))
        }

        await tx
          .update(importBatches)
          .set({ facilityId: targetFacilityId })
          .where(eq(importBatches.id, batchId))
      })

      revalidateTag('bookings', {})
      revalidateTag('billing', {})

      return Response.json({ data: { ok: true, facilityName: target.name } })
    }

    if (parsed.data.action === 'rename') {
      await db
        .update(facilities)
        .set({ name: parsed.data.name })
        .where(eq(facilities.id, batch.facilityId))
      revalidateTag('facilities', {})
      return Response.json({ data: { ok: true } })
    }

    return Response.json({ error: 'Unknown action' }, { status: 422 })
  } catch (err) {
    console.error('[PUT /api/log/import-batches/:id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
