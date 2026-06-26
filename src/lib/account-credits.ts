// Shared "account credit" primitive. A credit is an amount of money received
// (prepayment, gift, coupon) that is NOT yet attributed to any invoice — it sits
// as an unapplied credit until a bookkeeper/admin manually applies it to chosen
// invoices via applyCreditToInvoices (src/lib/unapplied-apply.ts). This is the
// same table QB customer credits live in, so the existing apply UI works on them.

import { db } from '@/db'
import { qbUnappliedCredits, residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensureUnappliedSchema } from './unapplied-ddl'

export type CreditSource = 'Prepayment' | 'Gift' | 'Coupon'

export async function createAccountCredit(opts: {
  facilityId: string
  residentId: string
  amountCents: number
  source: CreditSource
  num?: string | null
  txnDate?: string // YYYY-MM-DD; defaults to today (UTC date)
}): Promise<string> {
  await ensureUnappliedSchema()

  // qb_customer_id is NOT NULL. Use the resident's QB id when present, else a
  // stable synthetic so site-created credits never violate the constraint.
  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, opts.residentId),
    columns: { qbCustomerId: true },
  })
  const qbCustomerId = resident?.qbCustomerId ?? `RES-${opts.residentId.slice(0, 8)}`
  const txnDate = opts.txnDate ?? new Date().toISOString().slice(0, 10)

  const [row] = await db
    .insert(qbUnappliedCredits)
    .values({
      facilityId: opts.facilityId,
      residentId: opts.residentId,
      qbCustomerId,
      txnType: opts.source,
      txnDate,
      num: opts.num ?? null,
      amountCents: opts.amountCents,
      openBalanceCents: opts.amountCents,
      appliedCents: 0,
    })
    .returning({ id: qbUnappliedCredits.id })

  return row.id
}
