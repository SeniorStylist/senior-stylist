// Site-paid protection for QB invoices.
//
// The site reduces qb_invoices.open_balance_cents in six places (card charge,
// salon-credit draw, in-app payment, portal Stripe checkout, credit
// application, check-scan save) and NONE of them write to QuickBooks. The
// nightly invoice pull and the CSV importers are QB-authoritative and would
// copy QuickBooks' still-open balance back over the site's — re-opening an
// invoice the family already paid, which the 06:00 autopay sweep would then
// charge AGAIN.
//
// Fix: every site-side decrement also records `site_paid_cents` for the
// invoice, and every QB-authoritative overwrite calls reapplySitePayments()
// afterwards, which clamps
//   local_open = max(0, qb_open - site_paid)
// i.e. it assumes QuickBooks does NOT yet know about the site's money. This is
// the CONSERVATIVE choice: it can only ever LOWER a balance, so the sweep can
// never charge a card for money the site already collected. The trade-off is
// the case where QuickBooks ALSO shows a reduction on the same invoice — either
// the bookkeeper mirrored the site payment there (then we under-open by that
// amount and the site under-collects until QB closes it) or a genuinely
// different payment arrived (then the family double-paid and a refund is due).
// We can't tell those apart from balances alone, so those invoices are
// returned as `ambiguous` for a human to reconcile instead of guessed at.

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
 * The site payment for `cents` of an invoice has now been written INTO
 * QuickBooks (qb-payment-mirror.ts), so QuickBooks knows about that money:
 * release the same amount from the clamp, otherwise the next QB-authoritative
 * pull would subtract it twice (QB balance already lower + site_paid) and
 * under-open the invoice. Never goes below zero.
 */
export async function recordSiteMirrored(exec: Exec, invoiceId: string, cents: number): Promise<void> {
  if (cents <= 0) return
  await exec.execute(sql`
    UPDATE qb_invoice_site_payments
    SET site_paid_cents = GREATEST(0, site_paid_cents - ${cents}), updated_at = now()
    WHERE invoice_id = ${invoiceId}::uuid
  `)
}

export interface AmbiguousInvoice {
  id: string
  invoiceNum: string
  residentId: string | null
  qbOpenCents: number
  sitePaidCents: number
}

/**
 * After a QB-authoritative overwrite of open balances (nightly pull, CSV
 * import, legacy import), clamp every site-paid invoice back down. ONE
 * statement for all facilities given (max:1 pool — never per-row). Returns the
 * invoices where BOTH sides show a reduction (see header) for reconciliation.
 */
export async function reapplySitePayments(
  exec: Exec,
  facilityIds: string[],
): Promise<{ ambiguous: AmbiguousInvoice[] }> {
  if (facilityIds.length === 0) return { ambiguous: [] }
  const ids = sql.join(facilityIds.map((id) => sql`${id}::uuid`), sql`, `)

  // Detect BEFORE clamping: open_balance still equals QB's value here.
  const rows = (await exec.execute(sql`
    SELECT i.id, i.invoice_num, i.resident_id, i.open_balance_cents, s.site_paid_cents
    FROM qb_invoices i
    JOIN qb_invoice_site_payments s ON s.invoice_id = i.id
    WHERE s.site_paid_cents > 0
      AND i.facility_id IN (${ids})
      AND i.status <> 'void'
      AND i.open_balance_cents > 0
      AND i.open_balance_cents < i.amount_cents
  `)) as unknown as Array<{
    id: string
    invoice_num: string
    resident_id: string | null
    open_balance_cents: number | string
    site_paid_cents: number | string
  }>
  const ambiguous: AmbiguousInvoice[] = rows.map((r) => ({
    id: r.id,
    invoiceNum: r.invoice_num,
    residentId: r.resident_id,
    qbOpenCents: Number(r.open_balance_cents),
    sitePaidCents: Number(r.site_paid_cents),
  }))

  await exec.execute(sql`
    UPDATE qb_invoices i SET
      open_balance_cents = GREATEST(0, i.open_balance_cents - s.site_paid_cents),
      status = CASE
        WHEN i.status = 'void' THEN 'void'
        WHEN GREATEST(0, i.open_balance_cents - s.site_paid_cents) = 0 THEN 'paid'
        WHEN GREATEST(0, i.open_balance_cents - s.site_paid_cents) < i.amount_cents THEN 'partial'
        ELSE 'open'
      END,
      updated_at = now()
    FROM qb_invoice_site_payments s
    WHERE s.invoice_id = i.id
      AND s.site_paid_cents > 0
      AND i.facility_id IN (${ids})
      AND i.open_balance_cents > GREATEST(0, i.open_balance_cents - s.site_paid_cents)
  `)

  return { ambiguous }
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
