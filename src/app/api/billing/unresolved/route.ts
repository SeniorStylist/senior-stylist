import { createClient } from '@/lib/supabase/server'
import { createStorageClient } from '@/lib/supabase/storage'
import { db } from '@/db'
import { qbUnresolvedPayments, facilities } from '@/db/schema'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && (!facilityUser || facilityUser.role !== 'admin')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const queryFacilityId = url.searchParams.get('facilityId')
    const scopeFacilityId = isMaster
      ? queryFacilityId || null
      : facilityUser?.facilityId ?? null

    if (!isMaster && !scopeFacilityId) {
      return Response.json({ data: [] })
    }

    const whereClause = scopeFacilityId
      ? and(
          isNull(qbUnresolvedPayments.resolvedAt),
          eq(qbUnresolvedPayments.facilityId, scopeFacilityId),
        )
      : isNull(qbUnresolvedPayments.resolvedAt)

    const rows = await db
      .select({
        id: qbUnresolvedPayments.id,
        facilityId: qbUnresolvedPayments.facilityId,
        facilityName: facilities.name,
        facilityCode: facilities.facilityCode,
        checkImageUrl: qbUnresolvedPayments.checkImageUrl,
        createdAt: qbUnresolvedPayments.createdAt,
        extractedCheckNum: qbUnresolvedPayments.extractedCheckNum,
        extractedCheckDate: qbUnresolvedPayments.extractedCheckDate,
        extractedAmountCents: qbUnresolvedPayments.extractedAmountCents,
        extractedPayerName: qbUnresolvedPayments.extractedPayerName,
        extractedInvoiceRef: qbUnresolvedPayments.extractedInvoiceRef,
        extractedInvoiceDate: qbUnresolvedPayments.extractedInvoiceDate,
        extractedResidentLines: qbUnresolvedPayments.extractedResidentLines,
        confidenceOverall: qbUnresolvedPayments.confidenceOverall,
        unresolvedReason: qbUnresolvedPayments.unresolvedReason,
        rawOcrJson: qbUnresolvedPayments.rawOcrJson,
      })
      .from(qbUnresolvedPayments)
      .leftJoin(facilities, eq(facilities.id, qbUnresolvedPayments.facilityId))
      .where(whereClause)
      .orderBy(desc(qbUnresolvedPayments.createdAt))
      .limit(200)

    const storage = createStorageClient()
    const data = await Promise.all(
      rows.map(async (r) => {
        let signedUrl: string | null = null
        if (r.checkImageUrl) {
          const res = await storage.storage
            .from('check-images')
            .createSignedUrl(r.checkImageUrl, 3600)
          signedUrl = res.data?.signedUrl ?? null
        }
        return { ...r, checkImageUrl: signedUrl }
      }),
    )

    return Response.json({ data })
  } catch (err) {
    console.error('[unresolved] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
