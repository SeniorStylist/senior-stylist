import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'
import { db } from '@/db'
import { bookings, importBatches, facilities } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'

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

      await db.transaction(async (tx) => {
        await tx
          .update(importBatches)
          .set({ facilityId: targetFacilityId })
          .where(eq(importBatches.id, batchId))
        await tx
          .update(bookings)
          .set({ facilityId: targetFacilityId, updatedAt: new Date() })
          .where(eq(bookings.importBatchId, batchId))
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
