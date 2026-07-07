// Nightly COF auto-collect sweep. Runs every night; each facility is processed
// only when its configured cadence (nightly / biweekly / monthly) is due versus
// facilities.autopay_last_swept_at. For each due facility, every autopay-enabled
// resident with an outstanding balance is charged (card/salon), and the failover
// pay-link is sent on any uncollected remainder.
//
// Bearer CRON_SECRET gated. Registered in vercel.json.

import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { and, eq, gt } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { collectResidentBalance } from '@/lib/payments/triggers'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Max residents charged per invocation — keeps the lambda under maxDuration with
// the single pooled DB connection + sequential Stripe calls. A backlog clears over
// subsequent nightly runs; we log when we hit the cap.
const MAX_PER_RUN = 150

const CADENCE_DUE_MS: Record<string, number> = {
  nightly: 20 * 60 * 60 * 1000, // ~20h slack so a slightly-early nightly run still fires
  biweekly: 13 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await ensurePaymentsSchema()
    const now = Date.now()
    const dateKey = new Date().toISOString().slice(0, 10)

    const candidates = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, autopaySweepCadence: true, autopayLastSweptAt: true },
    })

    const dueFacilities = candidates.filter((f) => {
      const cadence = f.autopaySweepCadence ?? 'off'
      const threshold = CADENCE_DUE_MS[cadence]
      if (!threshold) return false // 'off' or unknown
      if (!f.autopayLastSweptAt) return true
      return now - new Date(f.autopayLastSweptAt).getTime() >= threshold
    })

    let attempted = 0
    let collected = 0
    let failed = 0
    let capped = false

    for (const facility of dueFacilities) {
      if (attempted >= MAX_PER_RUN) {
        capped = true
        break
      }
      const targets = await db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, facility.id),
          eq(residents.active, true),
          eq(residents.isDemo, false),
          eq(residents.autopayEnabled, true),
          gt(residents.qbOutstandingBalanceCents, 0),
        ),
        columns: { id: true },
      })

      let facilityAttempted = 0
      let facilityCollectedCents = 0
      let facilityFailed = 0
      for (const r of targets) {
        if (attempted >= MAX_PER_RUN) {
          capped = true
          break
        }
        const out = await collectResidentBalance(r.id, dateKey)
        if (out.attempted) {
          attempted++
          facilityAttempted++
          if (out.result?.ok) {
            collected++
            facilityCollectedCents += out.result.collectedCents
          } else {
            failed++
            facilityFailed++
          }
        }
      }

      // Safeguard (2026-07-07): the automated run must be visible to staff — bell
      // + push summary of what the sweep charged at this facility.
      if (facilityAttempted > 0) {
        const { notifyFacilityAdmins } = await import('@/lib/notify')
        await notifyFacilityAdmins(facility.id, {
          type: 'autopay_summary',
          title: 'Autopay ran overnight',
          body: `Collected $${(facilityCollectedCents / 100).toFixed(2)} from ${facilityAttempted - facilityFailed} resident${facilityAttempted - facilityFailed === 1 ? '' : 's'}${facilityFailed > 0 ? ` · ${facilityFailed} failed (payment links sent)` : ''}`,
          url: '/billing',
        })
      }

      // Bump the facility's cursor even if no residents were due — avoids
      // re-evaluating it every night for a monthly/biweekly cadence.
      if (!capped) {
        await db
          .update(facilities)
          .set({ autopayLastSweptAt: new Date(), updatedAt: new Date() })
          .where(eq(facilities.id, facility.id))
      }
    }

    if (capped) console.warn(`[autopay-sweep] hit MAX_PER_RUN=${MAX_PER_RUN}; remaining facilities/residents deferred to next run`)

    return Response.json({
      data: { dueFacilities: dueFacilities.length, attempted, collected, failed, capped },
    })
  } catch (err) {
    console.error('GET /api/cron/autopay-sweep error:', err)
    return Response.json({ error: 'Internal — logged' }, { status: 500 })
  }
}
