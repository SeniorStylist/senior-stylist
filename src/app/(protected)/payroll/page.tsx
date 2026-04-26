import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { payPeriods } from '@/db/schema'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { desc, eq } from 'drizzle-orm'
import { PayrollListClient, type PayPeriodSummary } from './payroll-list-client'

export default async function PayrollPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser || !canAccessPayroll(facilityUser.role)) redirect('/dashboard')

  let periods: PayPeriodSummary[] = []
  try {
    const rows = await db.query.payPeriods.findMany({
      where: eq(payPeriods.facilityId, facilityUser.facilityId),
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
