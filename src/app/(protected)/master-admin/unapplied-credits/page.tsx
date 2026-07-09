// Unapplied QB credits — payments QuickBooks received but never applied to an
// invoice. Imported via Step 5 on /master-admin/imports/quickbooks. Credits can be
// applied to open invoices ON THE SITE (auto-match by amount, or manually) — that
// updates website balances only; mirror each application inside QuickBooks or the
// next Step 2 import will revert it.

import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { qbUnappliedCredits, facilities, residents } from '@/db/schema'
import { asc, eq, sql } from 'drizzle-orm'
import { UnappliedClient, type CreditRowData } from './unapplied-client'

export const dynamic = 'force-dynamic'

export default async function UnappliedCreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const user = await getAuthUser()
  if (!user) redirect('/login')
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  const { facility: facilityFilter } = await searchParams

  let rows: CreditRowData[] = []
  let importedAt: string | null = null

  const baseSelect = {
    id: qbUnappliedCredits.id,
    txnType: qbUnappliedCredits.txnType,
    txnDate: qbUnappliedCredits.txnDate,
    num: qbUnappliedCredits.num,
    amountCents: qbUnappliedCredits.amountCents,
    openBalanceCents: qbUnappliedCredits.openBalanceCents,
    facilityId: qbUnappliedCredits.facilityId,
    facilityName: facilities.name,
    facilityCode: facilities.facilityCode,
    residentId: qbUnappliedCredits.residentId,
    residentName: residents.name,
    roomNumber: residents.roomNumber,
  }

  try {
    const [data, meta] = await Promise.all([
      db.select({
        ...baseSelect,
        appliedCents: qbUnappliedCredits.appliedCents,
        appliedAt: qbUnappliedCredits.appliedAt,
      })
        .from(qbUnappliedCredits)
        .innerJoin(facilities, eq(qbUnappliedCredits.facilityId, facilities.id))
        .leftJoin(residents, eq(qbUnappliedCredits.residentId, residents.id))
        .orderBy(asc(facilities.name), asc(qbUnappliedCredits.txnDate)),
      db.execute(sql`SELECT MAX(created_at) AS latest FROM qb_unapplied_credits`),
    ])
    rows = data.map((r) => ({
      ...r,
      appliedAt: r.appliedAt instanceof Date ? r.appliedAt.toISOString() : r.appliedAt,
    }))
    const latest = (meta as unknown as Array<{ latest: string | Date | null }>)[0]?.latest
    importedAt = latest ? new Date(latest).toISOString() : null
  } catch {
    // applied_* columns may not exist yet (0009 pending) — retry without them
    try {
      const data = await db.select(baseSelect)
        .from(qbUnappliedCredits)
        .innerJoin(facilities, eq(qbUnappliedCredits.facilityId, facilities.id))
        .leftJoin(residents, eq(qbUnappliedCredits.residentId, residents.id))
        .orderBy(asc(facilities.name), asc(qbUnappliedCredits.txnDate))
      rows = data.map((r) => ({ ...r, appliedCents: 0, appliedAt: null }))
    } catch {
      // Table may not exist until the first Step 5 import runs — render empty state
    }
  }

  return (
    <UnappliedClient
      rows={rows}
      importedAt={importedAt}
      initialFacilityFilter={facilityFilter ?? null}
    />
  )
}
