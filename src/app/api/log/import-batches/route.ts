import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'
import { db } from '@/db'
import { importBatches, facilities, profiles } from '@/db/schema'
import { eq, and, desc, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
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

    // Build the base query for OCR scan batches
    // Master admin sees all; bookkeepers see their own uploads; admins see their facility's
    const batchRows = await (isMasterAdmin
      ? db
          .select()
          .from(importBatches)
          .where(eq(importBatches.sourceType, 'ocr_scan'))
          .orderBy(desc(importBatches.createdAt))
          .limit(200)
      : facilityUser.role === 'bookkeeper'
        ? db
            .select()
            .from(importBatches)
            .where(and(eq(importBatches.sourceType, 'ocr_scan'), eq(importBatches.uploadedBy, user.id)))
            .orderBy(desc(importBatches.createdAt))
            .limit(200)
        : db
            .select()
            .from(importBatches)
            .where(and(eq(importBatches.sourceType, 'ocr_scan'), eq(importBatches.facilityId, facilityUser.facilityId)))
            .orderBy(desc(importBatches.createdAt))
            .limit(200))

    if (batchRows.length === 0) return Response.json({ data: [] })

    // Batch-load facilities and uploaders
    const facilityIds = [...new Set(batchRows.map((b) => b.facilityId))]
    const uploaderIds = [...new Set(batchRows.map((b) => b.uploadedBy))]

    const [facilityRows, uploaderRows] = await Promise.all([
      db
        .select({ id: facilities.id, name: facilities.name, facilityCode: facilities.facilityCode })
        .from(facilities)
        .where(inArray(facilities.id, facilityIds)),
      db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(inArray(profiles.id, uploaderIds)),
    ])

    const facilityMap = new Map(facilityRows.map((f) => [f.id, f]))
    const uploaderMap = new Map(uploaderRows.map((p) => [p.id, p]))

    const data = batchRows.map((b) => {
      const facility = facilityMap.get(b.facilityId)
      const uploader = uploaderMap.get(b.uploadedBy)
      return {
        id: b.id,
        facilityId: b.facilityId,
        facilityName: facility?.name ?? null,
        facilityCode: facility?.facilityCode ?? null,
        fileName: b.fileName,
        sourceType: b.sourceType,
        rowCount: b.rowCount,
        createdAt: b.createdAt,
        deletedAt: b.deletedAt,
        uploaderName: uploader?.fullName ?? null,
      }
    })

    return Response.json({ data })
  } catch (err) {
    console.error('[GET /api/log/import-batches] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
