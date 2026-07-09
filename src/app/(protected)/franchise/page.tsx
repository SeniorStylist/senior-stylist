import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, bookings, qbPayments } from '@/db/schema'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { getUserFranchise, isFranchiseAdmin } from '@/lib/get-facility-id'
import { FranchiseClient } from './franchise-client'

export const dynamic = 'force-dynamic'

export default async function FranchisePage() {
  const user = await getAuthUser()
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

    const facs = await db.query.facilities.findMany({
      where: and(inArray(facilities.id, ids), eq(facilities.active, true)),
      columns: { id: true, name: true, facilityCode: true, qbOutstandingBalanceCents: true, isDemo: true },
    })
    // A demo franchise (is_demo facilities) counts its demo bookings/payments so the
    // MTD tiles populate; a real franchise counts only real records. Franchises are
    // homogeneous — never a real+demo mix.
    const demoFranchise = facs.some((f) => f.isDemo)

    const [bookingRows, payRows] = await Promise.all([
      db
        .select({ facilityId: bookings.facilityId, n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(
          inArray(bookings.facilityId, ids),
          eq(bookings.active, true),
          eq(bookings.isDemo, demoFranchise),
          eq(bookings.status, 'completed'),
          gte(bookings.startTime, monthStart),
        ))
        .groupBy(bookings.facilityId),
      db
        .select({ facilityId: qbPayments.facilityId, c: sql<string>`coalesce(sum(amount_cents),0)::bigint` })
        .from(qbPayments)
        .where(and(
          inArray(qbPayments.facilityId, ids),
          eq(qbPayments.isDemo, demoFranchise),
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
