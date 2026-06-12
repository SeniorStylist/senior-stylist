// Signed URL for a saved check payment's scanned image. The `check-images`
// bucket is PRIVATE — the DB stores the storage PATH and signed URLs (1-hour
// TTL) are regenerated here at read time, never cached client-side beyond that.

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createStorageClient } from '@/lib/supabase/storage'
import { db } from '@/db'
import { qbPayments } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params
  if (!UUID_RE.test(paymentId)) {
    return Response.json({ error: 'Invalid paymentId' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  let callerFacilityId: string | null = null
  let callerRole: string | null = null
  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu || !canAccessBilling(fu.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    callerFacilityId = fu.facilityId
    callerRole = fu.role
  }

  try {
    const payment = await db.query.qbPayments.findFirst({
      where: eq(qbPayments.id, paymentId),
      columns: { id: true, facilityId: true, checkImageUrl: true },
    })
    // 404 (not 403) on cross-facility to avoid leaking payment existence
    if (!payment || !payment.checkImageUrl) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    if (
      !isMaster &&
      callerRole !== 'bookkeeper' &&
      payment.facilityId !== callerFacilityId
    ) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const storage = createStorageClient()
    const res = await storage.storage
      .from('check-images')
      .createSignedUrl(payment.checkImageUrl, 3600)
    if (!res.data?.signedUrl) {
      return Response.json({ error: 'Image unavailable' }, { status: 404 })
    }
    return Response.json({ data: { url: res.data.signedUrl } })
  } catch (err) {
    console.error('[billing/check-image] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
