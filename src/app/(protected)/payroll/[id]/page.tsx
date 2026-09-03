import { getAuthUser } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { facilities, payPeriods, quickbooksSyncLog } from '@/db/schema'
import { getUserFacility, canAccessPayrollFu } from '@/lib/get-facility-id'
import { isFacilityConnected } from '@/lib/qb-connection'
import { sanitizeStylist } from '@/lib/sanitize'
import { toClientJson } from '@/lib/sanitize'
import { and, desc, eq } from 'drizzle-orm'
import { PayrollDetailClient } from './payroll-detail-client'

export default async function PayrollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser || !canAccessPayrollFu(facilityUser, !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL)) redirect('/dashboard')

  const row = await db.query.payPeriods.findFirst({
    where: and(eq(payPeriods.id, id), eq(payPeriods.facilityId, facilityUser.facilityId)),
    with: {
      items: {
        with: { stylist: true, deductions: true },
      },
    },
  })
  if (!row) notFound()

  const items = row.items
    .map((it) => ({
      ...it,
      stylist: sanitizeStylist(it.stylist),
    }))
    .sort((a, b) => a.stylist.name.localeCompare(b.stylist.name))

  const { items: _drop, ...period } = row
  void _drop

  const [facility, hasQuickBooks] = await Promise.all([
    db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
      columns: {
        qbExpenseAccountId: true,
        qbRevShareType: true,
        revSharePercentage: true,
      },
    }),
    isFacilityConnected(facilityUser.facilityId),
  ])
  const hasExpenseAccount = !!facility?.qbExpenseAccountId

  const syncLog = await db.query.quickbooksSyncLog.findMany({
    where: eq(quickbooksSyncLog.payPeriodId, row.id),
    orderBy: [desc(quickbooksSyncLog.createdAt)],
    limit: 50,
    with: { stylist: { columns: { name: true } } },
  })

  return (
    <PayrollDetailClient
      period={toClientJson(period)}
      initialItems={toClientJson(items)}
      hasQuickBooks={hasQuickBooks}
      hasExpenseAccount={hasExpenseAccount}
      revShareType={facility?.qbRevShareType ?? null}
      revSharePercentage={facility?.revSharePercentage ?? null}
      syncLog={toClientJson(syncLog)}
    />
  )
}
