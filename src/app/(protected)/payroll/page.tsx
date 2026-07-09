import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { payPeriods } from '@/db/schema'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { and, desc, eq } from 'drizzle-orm'
import { PayrollListClient, type PayPeriodSummary } from './payroll-list-client'

export default async function PayrollPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser || !canAccessPayroll(facilityUser.role)) redirect('/dashboard')

  // is_demo filter — Phase 13: demo period only during a tour, real-only otherwise.
  const tutorialMode = await isTutorialModeActive()

  let periods: PayPeriodSummary[] = []
  try {
    const rows = await db.query.payPeriods.findMany({
      where: and(
        eq(payPeriods.facilityId, facilityUser.facilityId),
        eq(payPeriods.isDemo, tutorialMode),
      ),
      orderBy: [desc(payPeriods.startDate)],
      with: { items: { columns: { id: true, netPayCents: true } } },
    })

    periods = rows.map((p) => ({
      id: p.id,
      periodType: p.periodType,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      notes: p.notes,
      stylistCount: p.items.length,
      totalPayoutCents: p.items.reduce((s, it) => s + it.netPayCents, 0),
    }))
  } catch (err) {
    console.error('[payroll page] load error:', err)
  }

  return <PayrollListClient initialPeriods={periods} />
}
