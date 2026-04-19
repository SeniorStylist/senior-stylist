import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { payPeriods } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { sanitizeStylist } from '@/lib/sanitize'
import { toClientJson } from '@/lib/sanitize'
import { and, eq } from 'drizzle-orm'
import { PayrollDetailClient } from './payroll-detail-client'

export default async function PayrollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser || facilityUser.role !== 'admin') redirect('/dashboard')

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

  return (
    <PayrollDetailClient
      period={toClientJson(period)}
      initialItems={toClientJson(items)}
    />
  )
}
