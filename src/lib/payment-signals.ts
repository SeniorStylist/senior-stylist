// P51 — "is this resident's payment covered?" signals for stylist/staff
// booking surfaces. A resident is covered when they have an active saved card
// (payment_methods) and/or remaining salon credit (qb_unapplied_credits).
// Booleans only — amounts never leave the billing surfaces.
//
// ONE batched call per page (max:1 pool rule) — add the promise to the page's
// existing Promise.all and pass the map as a prop (the P36 carePrefs pattern).
// Never call per-row.

import { db } from '@/db'
import { paymentMethods, residents } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export interface PaymentCoverage {
  card: boolean
  credit: boolean
}

export type PaymentCoverageMap = Record<string, PaymentCoverage>

export async function getPaymentCoverageMap(facilityId: string): Promise<PaymentCoverageMap> {
  const map: PaymentCoverageMap = {}
  try {
    const [cardRows, creditRows] = await Promise.all([
      // Join through residents so a stale facility_id on a moved/merged
      // resident's card row can't hide (or leak) coverage.
      db
        .selectDistinct({ residentId: paymentMethods.residentId })
        .from(paymentMethods)
        .innerJoin(residents, eq(residents.id, paymentMethods.residentId))
        .where(and(eq(residents.facilityId, facilityId), eq(paymentMethods.active, true))),
      // Canonical remaining-credit expression (same as billing summary).
      // Falls back to plain open_balance on pre-applied_cents databases.
      (async () => {
        try {
          return (await db.execute(sql`
            SELECT resident_id FROM qb_unapplied_credits
            WHERE facility_id = ${facilityId} AND resident_id IS NOT NULL
            GROUP BY resident_id
            HAVING SUM(open_balance_cents - applied_cents) > 0
          `)) as unknown as Array<{ resident_id: string }>
        } catch {
          try {
            return (await db.execute(sql`
              SELECT resident_id FROM qb_unapplied_credits
              WHERE facility_id = ${facilityId} AND resident_id IS NOT NULL
              GROUP BY resident_id
              HAVING SUM(open_balance_cents) > 0
            `)) as unknown as Array<{ resident_id: string }>
          } catch {
            return [] as Array<{ resident_id: string }>
          }
        }
      })(),
    ])

    for (const r of cardRows) {
      map[r.residentId] = { card: true, credit: false }
    }
    for (const r of creditRows) {
      const cur = map[r.resident_id]
      if (cur) cur.credit = true
      else map[r.resident_id] = { card: false, credit: true }
    }
  } catch (err) {
    console.error('[payment-signals] coverage map failed (non-fatal):', err)
    return {}
  }
  return map
}

/** Single-resident variant for the peek drawer. */
export async function getPaymentCoverage(residentId: string): Promise<PaymentCoverage> {
  try {
    const [card, creditRows] = await Promise.all([
      db.query.paymentMethods.findFirst({
        where: and(eq(paymentMethods.residentId, residentId), eq(paymentMethods.active, true)),
        columns: { id: true },
      }),
      (async () => {
        try {
          return (await db.execute(sql`
            SELECT COALESCE(SUM(open_balance_cents - applied_cents), 0) AS c
            FROM qb_unapplied_credits
            WHERE resident_id = ${residentId}
          `)) as unknown as Array<{ c: number | string }>
        } catch {
          return [] as Array<{ c: number | string }>
        }
      })(),
    ])
    return { card: !!card, credit: (Number(creditRows[0]?.c ?? 0) || 0) > 0 }
  } catch {
    return { card: false, credit: false }
  }
}
