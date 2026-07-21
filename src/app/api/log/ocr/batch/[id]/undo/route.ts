// Roll back an OCR daily-log scan import and return its confirmed review sheets so
// the client can reopen the scan review pre-filled ("Undo & edit"). Soft-deletes the
// batch's bookings (active=false) and stamps the batch deletedAt. Accessible to the
// users who can scan logs (admin/facility_staff/bookkeeper) + master — NOT the
// master-only /api/super-admin/import-batches rollback. Scoped: admin/facility_staff
// to their own facility; bookkeeper + master cross-facility.

import { NextRequest } from 'next/server'
import { db } from '@/db'
import { bookings, importBatches } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    // P37 — stylists may undo batches THEY uploaded (own-sheet scans), mirroring
    // the bookkeeper own-uploads rule in import-batches/[batchId].
    const isStylist = facilityUser.role === 'stylist'
    if (!isMaster && !canScanLogs(facilityUser.role) && !isStylist) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const batch = await db.query.importBatches.findFirst({
      where: eq(importBatches.id, id),
      columns: { id: true, facilityId: true, sourceType: true, deletedAt: true, reviewPayload: true, uploadedBy: true },
    })
    if (!batch || batch.sourceType !== 'ocr_scan') return Response.json({ error: 'Not found' }, { status: 404 })

    // Scope: bookkeeper + master cross-facility; others own facility only.
    // Stylists additionally must be the batch's uploader.
    const canCrossFacility = isMaster || facilityUser.role === 'bookkeeper'
    if (!canCrossFacility && batch.facilityId !== facilityUser.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (isStylist && !isMaster && batch.uploadedBy !== user.id) {
      return Response.json({ error: 'You can only undo scans you uploaded yourself.' }, { status: 403 })
    }

    if (!batch.deletedAt) {
      await db.transaction(async (tx) => {
        await tx
          .update(bookings)
          .set({ active: false, updatedAt: new Date() })
          .where(and(eq(bookings.importBatchId, id), eq(bookings.active, true)))
        await tx.update(importBatches).set({ deletedAt: sql`now()` }).where(eq(importBatches.id, id))
      })
      revalidateTag('bookings', {})
    }

    return Response.json({ data: { facilityId: batch.facilityId, sheets: batch.reviewPayload ?? null } })
  } catch (err) {
    console.error('POST /api/log/ocr/batch/[id]/undo error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
