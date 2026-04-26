import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbPayments } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { reconcilePayment } from '@/lib/reconciliation'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'

async function authorize(paymentId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const payment = await db.query.qbPayments.findFirst({
    where: eq(qbPayments.id, paymentId),
    columns: { id: true, facilityId: true },
  })
  if (!payment) {
    return { error: Response.json({ error: 'Not found' }, { status: 404 }) }
  }

  if (!isMaster) {
    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser || !canAccessBilling(facilityUser.role)) {
      return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    if (facilityUser.facilityId !== payment.facilityId) {
      return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    }
  }

  return { payment }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    const { paymentId } = await params
    const auth = await authorize(paymentId)
    if ('error' in auth) return auth.error

    const result = await reconcilePayment(paymentId, auth.payment.facilityId)
    revalidateTag('billing', {})
    return Response.json({ data: result })
  } catch (err) {
    console.error('POST /api/billing/reconcile/[paymentId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    const { paymentId } = await params
    const auth = await authorize(paymentId)
    if ('error' in auth) return auth.error

    const row = await db.query.qbPayments.findFirst({
      where: and(eq(qbPayments.id, paymentId), eq(qbPayments.facilityId, auth.payment.facilityId)),
      columns: {
        reconciliationStatus: true,
        reconciledAt: true,
        reconciliationNotes: true,
        reconciliationLines: true,
      },
    })
    return Response.json({
      data: {
        status: row?.reconciliationStatus ?? 'unreconciled',
        lines: row?.reconciliationLines ?? [],
        reconciledAt: row?.reconciledAt ?? null,
        notes: row?.reconciliationNotes ?? null,
      },
    })
  } catch (err) {
    console.error('GET /api/billing/reconcile/[paymentId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
