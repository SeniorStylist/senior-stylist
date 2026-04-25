import { db } from '@/db'
import { bookings, stylists } from '@/db/schema'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

function formatDateTime(d: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ residentId?: string }>
}) {
  const { facilityCode } = await params
  const { residentId: searchResidentId } = await searchParams
  const decoded = decodeURIComponent(facilityCode)
  const { residentsAtFacility } = await requirePortalAuth(decoded)
  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const now = new Date()
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const [upcoming, past] = await Promise.all([
    db
      .select({
        id: bookings.id,
        startTime: bookings.startTime,
        serviceNames: bookings.serviceNames,
        status: bookings.status,
        stylistId: bookings.stylistId,
        portalNotes: bookings.portalNotes,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.residentId, selected.residentId),
          gte(bookings.startTime, now),
          inArray(bookings.status, ['scheduled', 'requested']),
        ),
      )
      .orderBy(asc(bookings.startTime)),
    db
      .select({
        id: bookings.id,
        startTime: bookings.startTime,
        serviceNames: bookings.serviceNames,
        status: bookings.status,
        stylistId: bookings.stylistId,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.residentId, selected.residentId),
          gte(bookings.startTime, sixMonthsAgo),
          lte(bookings.startTime, now),
          eq(bookings.status, 'completed'),
        ),
      )
      .orderBy(desc(bookings.startTime)),
  ])

  const stylistIds = Array.from(
    new Set([...upcoming, ...past].map((b) => b.stylistId).filter(Boolean) as string[]),
  )
  const stylistMap = new Map<string, string>()
  if (stylistIds.length) {
    const rows = await db
      .select({ id: stylists.id, name: stylists.name })
      .from(stylists)
      .where(inArray(stylists.id, stylistIds))
    rows.forEach((r) => stylistMap.set(r.id, r.name))
  }

  return (
    <div className="page-enter flex flex-col gap-5">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          Appointments
        </h1>
        <p className="text-sm text-stone-500 mt-1">For {selected.residentName}</p>
      </header>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-3">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-stone-400">No upcoming appointments.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {upcoming.map((b) => {
              const services = b.serviceNames?.join(', ') ?? 'Service'
              const stylistName = stylistMap.get(b.stylistId) ?? '—'
              const isRequested = b.status === 'requested'
              return (
                <li key={b.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-stone-900">{formatDateTime(new Date(b.startTime))}</p>
                      <p className="text-[12px] text-stone-500 mt-0.5">{services} · {stylistName}</p>
                      {b.portalNotes && (
                        <p className="text-[11.5px] text-stone-400 mt-1 italic">&ldquo;{b.portalNotes}&rdquo;</p>
                      )}
                    </div>
                    <span
                      className={
                        isRequested
                          ? 'text-[10.5px] font-semibold rounded-full px-2.5 py-1 bg-amber-100 text-amber-800 shrink-0'
                          : 'text-[10.5px] font-semibold rounded-full px-2.5 py-1 bg-blue-100 text-blue-800 shrink-0'
                      }
                    >
                      {isRequested ? 'Pending approval' : 'Scheduled'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-3">Past 6 months</h2>
        {past.length === 0 ? (
          <p className="text-sm text-stone-400">No completed appointments in the past 6 months.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {past.map((b) => {
              const services = b.serviceNames?.join(', ') ?? 'Service'
              const stylistName = stylistMap.get(b.stylistId) ?? '—'
              return (
                <li key={b.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-stone-900">{formatDateTime(new Date(b.startTime))}</p>
                    <p className="text-[12px] text-stone-500 mt-0.5">{services} · {stylistName}</p>
                  </div>
                  <span className="text-[10.5px] font-semibold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-700 shrink-0">
                    Completed
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
