import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, quickbooksSyncLog } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { pushQBInvoices } from '@/lib/qb-invoice-push'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Batched QB API calls (JIT customer creates + one invoice per resident) —
// a 40-resident month can take well over 60s.
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const pushSchema = z.object({
  facilityId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  mode: z.enum(['per_resident', 'facility']),
  residentId: z.string().uuid().optional(),
  send: z.boolean().default(false),
  email: z.string().email().max(320).optional(),
})

// Operator-clicked WRITE to the facility's books — manage tier only, ungated
// by QB_INVOICE_SYNC_ENABLED (same posture as the payroll Bill push).
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => null)
    const parsed = pushSchema.safeParse(raw)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid input' }, { status: 400 })
    }
    const { facilityId, month, mode, residentId, send, email } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canManageQuickBooksBilling(fu.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (fu.facilityId !== facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('qbInvoicePush', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { qbRealmId: true, qbAccessToken: true, qbRefreshToken: true },
    })
    if (!facility?.qbRealmId || !facility.qbAccessToken || !facility.qbRefreshToken) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }

    const result = await pushQBInvoices(facilityId, {
      month,
      mode,
      residentId: residentId ?? null,
      send,
      email: email ?? null,
      createdBy: user.id,
    })

    db.insert(quickbooksSyncLog)
      .values({
        facilityId,
        action: 'push_invoice',
        status: result.errors.length > 0 ? 'error' : 'success',
        errorMessage:
          result.errors.length > 0 ? result.errors.slice(0, 3).join(' | ').slice(0, 500) : null,
        responseSummary: `${result.invoices.length} invoice(s) for ${month} (${mode})`,
      })
      .catch((e) => console.error('[qb-log]', e))

    revalidateTag('billing', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('[quickbooks/push-invoice] error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
