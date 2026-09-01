// Site-paid protection for QB invoices.
//
// The site reduces qb_invoices.open_balance_cents in five places (card charge,
// in-app payment, portal Stripe checkout, salon-credit draw, credit
// application) and NONE of them write to QuickBooks. The nightly invoice pull
// and the CSV importers are QB-authoritative and would copy QuickBooks' still-
// open balance back over the site's — re-opening an invoice the family already
// paid, which the 06:00 autopay sweep would then charge AGAIN.
//
// Fix: every site-side decrement also records `site_paid_cents` for the
// invoice, and every QB-authoritative overwrite calls reapplySitePayments()
// afterwards, which clamps:
//   local_open = max(0, min(qb_open, qb_amount - site_paid))
// That never double-subtracts once QuickBooks catches up (min), and never
// raises a balance (only lowers). Rows with no site payments are untouched.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Exec = Tx | typeof db

/** Record that `cents` of an invoice was collected on the site. Safe inside a tx. */
export async function recordSitePaid(exec: Exec, invoiceId: string, cents: number): Promise<void> {
  if (cents <= 0) return
  await exec.execute(sql`
    INSERT INTO qb_invoice_site_payments (invoice_id, site_paid_cents, updated_at)
    VALUES (${invoiceId}::uuid, ${cents}, now())
    ON CONFLICT (invoice_id) DO UPDATE SET
      site_paid_cents = qb_invoice_site_payments.site_paid_cents + excluded.site_paid_cents,
      updated_at = now()
  `)
}

/**
 * After a QB-authoritative overwrite of open balances (nightly pull, CSV
 * import, legacy import), clamp every site-paid invoice back down. ONE
 * statement for all facilities given (max:1 pool — never per-row).
 */
export async function reapplySitePayments(exec: Exec, facilityIds: string[]): Promise<void> {
  if (facilityIds.length === 0) return
  const ids = sql.join(facilityIds.map((id) => sql`${id}::uuid`), sql`, `)
  await exec.execute(sql`
    UPDATE qb_invoices i SET
      open_balance_cents = GREATEST(0, LEAST(i.open_balance_cents, i.amount_cents - s.site_paid_cents)),
      status = CASE
        WHEN i.status = 'void' THEN 'void'
        WHEN GREATEST(0, LEAST(i.open_balance_cents, i.amount_cents - s.site_paid_cents)) = 0 THEN 'paid'
        WHEN GREATEST(0, LEAST(i.open_balance_cents, i.amount_cents - s.site_paid_cents)) < i.amount_cents THEN 'partial'
        ELSE 'open'
      END,
      updated_at = now()
    FROM qb_invoice_site_payments s
    WHERE s.invoice_id = i.id
      AND s.site_paid_cents > 0
      AND i.facility_id IN (${ids})
      AND i.open_balance_cents > GREATEST(0, LEAST(i.open_balance_cents, i.amount_cents - s.site_paid_cents))
  `)
}

/** Map invoiceId → site_paid_cents for a facility (used by undo to skip paid rows). */
export async function loadSitePaidMap(facilityId: string): Promise<Map<string, number>> {
  const rows = (await db.execute(sql`
    SELECT s.invoice_id, s.site_paid_cents
    FROM qb_invoice_site_payments s
    JOIN qb_invoices i ON i.id = s.invoice_id
    WHERE i.facility_id = ${facilityId}::uuid AND s.site_paid_cents > 0
  `)) as unknown as Array<{ invoice_id: string; site_paid_cents: number | string }>
  return new Map(rows.map((r) => [r.invoice_id, Number(r.site_paid_cents)]))
}
