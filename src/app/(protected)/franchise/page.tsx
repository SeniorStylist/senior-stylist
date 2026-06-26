import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, bookings, qbPayments } from '@/db/schema'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { getUserFranchise, isFranchiseAdmin } from '@/lib/get-facility-id'
import { FranchiseClient } from './franchise-client'

export const dynamic = 'force-dynamic'

export default async function FranchisePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isMaster = !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  const isFranch = await isFranchiseAdmin(user.id)
  if (!isFranch && !isMaster) redirect('/dashboard')

  try {
    const franchise = await getUserFranchise(user.id)
    if (!franchise || franchise.facilityIds.length === 0) {
      return <FranchiseClient franchiseName={null} facilities={[]} />
    }

    const ids = franchise.facilityIds
    // Month-to-date window (UTC — a rough operational metric).
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const monthStartDate = monthStart.toISOString().slice(0, 10)

    const [facs, bookingRows, payRows] = await Promise.all([
      db.query.facilities.findMany({
        where: and(inArray(facilities.id, ids), eq(facilities.active, true)),
        columns: { id: true, name: true, facilityCode: true, qbOutstandingBalanceCents: true },
      }),
      db
        .select({ facilityId: bookings.facilityId, n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(
          inArray(bookings.facilityId, ids),
          eq(bookings.active, true),
          eq(bookings.isDemo, false),
          eq(bookings.status, 'completed'),
          gte(bookings.startTime, monthStart),
        ))
        .groupBy(bookings.facilityId),
      db
        .select({ facilityId: qbPayments.facilityId, c: sql<string>`coalesce(sum(amount_cents),0)::bigint` })
        .from(qbPayments)
        .where(and(
          inArray(qbPayments.facilityId, ids),
          eq(qbPayments.isDemo, false),
          gte(qbPayments.paymentDate, monthStartDate),
        ))
        .groupBy(qbPayments.facilityId),
    ])

    const bookingMap = new Map(bookingRows.map((r) => [r.facilityId, Number(r.n)]))
    const payMap = new Map(payRows.map((r) => [r.facilityId, Number(r.c)]))

    const rows = facs
      .map((f) => ({
        id: f.id,
        name: f.name,
        facilityCode: f.facilityCode,
        outstandingCents: f.qbOutstandingBalanceCents ?? 0,
        bookingsThisMonth: bookingMap.get(f.id) ?? 0,
        collectedThisMonthCents: payMap.get(f.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return <FranchiseClient franchiseName={franchise.franchiseName} facilities={rows} />
  } catch (err) {
    console.error('[FranchisePage] error:', err)
    return <FranchiseClient franchiseName={null} facilities={[]} />
  }
}
