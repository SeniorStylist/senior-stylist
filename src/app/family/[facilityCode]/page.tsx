import Link from 'next/link'
import { db } from '@/db'
import { bookings, residents, stylists } from '@/db/schema'
import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

function formatDollars(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100)
}

function formatDateTime(d: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export default async function FamilyHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ residentId?: string }>
}) {
  const { facilityCode } = await params
  const { residentId: searchResidentId } = await searchParams
  const decoded = decodeURIComponent(facilityCode)
  const { session, residentsAtFacility } = await requirePortalAuth(decoded)

  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const residentRow = await db.query.residents.findFirst({
    where: eq(residents.id, selected.residentId),
    columns: { id: true, name: true, qbOutstandingBalanceCents: true },
  })

  const upcoming = await db
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
        gte(bookings.startTime, new Date()),
        inArray(bookings.status, ['scheduled', 'requested']),
      ),
    )
    .orderBy(asc(bookings.startTime))
    .limit(3)

  const stylistIds = Array.from(new Set(upcoming.map((b) => b.stylistId).filter(Boolean))) as string[]
  const stylistMap = new Map<string, string>()
  if (stylistIds.length) {
    const rows = await db
      .select({ id: stylists.id, name: stylists.name })
      .from(stylists)
      .where(inArray(stylists.id, stylistIds))
    rows.forEach((r) => stylistMap.set(r.id, r.name))
  }

  const greeting = session.email.split('@')[0]
  const outstanding = residentRow?.qbOutstandingBalanceCents ?? 0

  return (
    <div className="page-enter flex flex-col gap-4">
      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <p className="text-xs uppercase tracking-wide text-stone-400 font-semibold">Welcome back</p>
        <h1 className="text-2xl text-stone-900 mt-1" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          Hi, {greeting}
        </h1>
        <p className="text-sm text-stone-500 mt-1">
          Here&apos;s {selected.residentName} at {selected.facilityName}.
        </p>
      </section>

      <section
        className={
          outstanding > 0
            ? 'rounded-2xl border border-amber-200 bg-amber-50 p-5'
            : 'rounded-2xl border border-emerald-200 bg-emerald-50 p-5'
        }
      >
        {outstanding > 0 ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold">Balance attention</p>
              <p className="text-2xl text-amber-900 font-semibold mt-1">{formatDollars(outstanding)}</p>
              <p className="text-xs text-amber-800 mt-1">Outstanding balance — pay online or by check.</p>
            </div>
            <Link
              href={`/family/${encodeURIComponent(decoded)}/billing?residentId=${selected.residentId}`}
              className="inline-flex items-center justify-center bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-4 py-2.5 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C]"
            >
              View billing
            </Link>
          </div>
        ) : (
          <div>
            <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">All paid up</p>
            <p className="text-sm text-emerald-900 mt-1">No outstanding balance — thank you.</p>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-900">Upcoming appointments</h2>
          <Link
            href={`/family/${encodeURIComponent(decoded)}/appointments?residentId=${selected.residentId}`}
            className="text-xs font-semibold text-[#8B2E4A] hover:underline"
          >
            View all →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-stone-400">No upcoming appointments scheduled.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {upcoming.map((b) => {
              const services = b.serviceNames?.join(', ') ?? 'Service'
              const stylistName = stylistMap.get(b.stylistId) ?? '—'
              const statusLabel =
                b.status === 'requested' ? (
                  <span className="text-[10.5px] font-semibold rounded-full px-2.5 py-1 bg-amber-100 text-amber-800">
                    Pending approval
                  </span>
                ) : (
                  <span className="text-[10.5px] font-semibold rounded-full px-2.5 py-1 bg-blue-100 text-blue-800">
                    Scheduled
                  </span>
                )
              return (
                <li key={b.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-stone-900">{formatDateTime(new Date(b.startTime))}</p>
                    <p className="text-[12px] text-stone-500 mt-0.5 truncate">
                      {services} · {stylistName}
                    </p>
                  </div>
                  {statusLabel}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Link
        href={`/family/${encodeURIComponent(decoded)}/request?residentId=${selected.residentId}`}
        className="inline-flex items-center justify-center gap-2 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] hover:shadow-[0_6px_16px_rgba(139,46,74,0.32)] transition-all"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Request a service
      </Link>
    </div>
  )
}
