import { db } from '@/db'
import { bookings, facilities, residentPhotos, signupSheetEntries, stylists } from '@/db/schema'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'
import { createStorageClient, RESIDENT_PHOTOS_BUCKET } from '@/lib/supabase/storage'
import { ensureResidentPhotosSchema } from '@/lib/resident-photos-ddl'
import { ensureSignupSheetSchema } from '@/lib/signup-sheet-ddl'
import { getPortalT } from '@/lib/portal-i18n-server'
import { portalLocale } from '@/lib/portal-i18n'

export const dynamic = 'force-dynamic'

// P53 — tz passed explicitly: server-tz formatting (UTC on Vercel) disagreed
// with the confirmation email (which formats in facility tz).
function formatDateTime(d: Date, locale: string, tz: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(d)
}

function formatDateOnly(d: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00Z'))
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
  const { lang, t } = await getPortalT()
  const locale = portalLocale(lang)
  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const now = new Date()
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const [upcoming, past, facilityRow, pendingRequests] = await Promise.all([
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
    db.query.facilities.findFirst({
      where: eq(facilities.id, selected.facilityId),
      columns: { timezone: true },
    }),
    // P53 — pending sign-up requests: a submitted request used to be
    // INVISIBLE here until the stylist converted it (families re-submitted).
    ensureSignupSheetSchema()
      .then(() =>
        db
          .select({
            id: signupSheetEntries.id,
            serviceName: signupSheetEntries.serviceName,
            preferredDate: signupSheetEntries.preferredDate,
            preferredDateTo: signupSheetEntries.preferredDateTo,
            notes: signupSheetEntries.notes,
          })
          .from(signupSheetEntries)
          .where(and(eq(signupSheetEntries.residentId, selected.residentId), eq(signupSheetEntries.status, 'pending')))
          .orderBy(desc(signupSheetEntries.createdAt))
          .limit(10),
      )
      .catch(() => [] as Array<{ id: string; serviceName: string; preferredDate: string | null; preferredDateTo: string | null; notes: string | null }>),
  ])
  const facilityTz = facilityRow?.timezone ?? 'America/New_York'

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

  // Phase 16 G11 — style photos the salon chose to share, per past booking.
  // ONE inArray query scoped to THIS resident + shared_with_family only; signed
  // URLs generated server-side (raw storage paths never reach the client).
  const photosByBooking = new Map<string, { url: string; caption: string | null }[]>()
  if (past.length > 0) {
    try {
      await ensureResidentPhotosSchema()
      const photoRows = await db.query.residentPhotos.findMany({
        where: and(
          eq(residentPhotos.residentId, selected.residentId),
          eq(residentPhotos.sharedWithFamily, true),
          inArray(residentPhotos.bookingId, past.map((b) => b.id)),
        ),
        orderBy: [desc(residentPhotos.createdAt)],
        limit: 60,
        columns: { bookingId: true, path: true, caption: true },
      })
      if (photoRows.length > 0) {
        const storage = createStorageClient()
        await Promise.all(
          photoRows.map(async (p) => {
            if (!p.bookingId) return
            const { data } = await storage.storage.from(RESIDENT_PHOTOS_BUCKET).createSignedUrl(p.path, 3600)
            if (!data?.signedUrl) return
            const list = photosByBooking.get(p.bookingId) ?? []
            list.push({ url: data.signedUrl, caption: p.caption })
            photosByBooking.set(p.bookingId, list)
          }),
        )
      }
    } catch (err) {
      console.error('[portal appointments] photos load failed (non-fatal):', err)
    }
  }

  return (
    <div className="page-enter flex flex-col gap-5">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          {t('appts.title')}
        </h1>
        <p className="text-sm text-stone-500 mt-1">{t('appts.for', { name: selected.residentName })}</p>
      </header>

      {/* P53 — pending requests: visible the moment the family submits, so a
          "did it go through?" gap no longer causes duplicate requests. */}
      {pendingRequests.length > 0 && (
        <section className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
          <h2 className="text-sm font-semibold text-amber-900 mb-1">{t('appts.requestedTitle')}</h2>
          <p className="text-xs text-amber-800/80 mb-3">{t('appts.requestedWaiting')}</p>
          <ul className="flex flex-col divide-y divide-amber-100">
            {pendingRequests.map((r) => (
              <li key={r.id} className="py-2.5">
                <p className="text-[13.5px] font-semibold text-stone-900">{r.serviceName}</p>
                {(r.preferredDate || r.notes) && (
                  <p className="text-[12px] text-stone-600 mt-0.5">
                    {r.preferredDate && (
                      <>
                        {t('appts.requestedFor')}{' '}
                        {formatDateOnly(r.preferredDate, locale)}
                        {r.preferredDateTo && r.preferredDateTo !== r.preferredDate && <> – {formatDateOnly(r.preferredDateTo, locale)}</>}
                      </>
                    )}
                    {r.preferredDate && r.notes && ' · '}
                    {r.notes && <span className="italic">{r.notes}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-3">{t('appts.upcoming')}</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-stone-400">{t('appts.noUpcoming')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {upcoming.map((b) => {
              const services = b.serviceNames?.join(', ') ?? t('common.service')
              const stylistName = stylistMap.get(b.stylistId) ?? '—'
              const isRequested = b.status === 'requested'
              return (
                <li key={b.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-stone-900">{formatDateTime(new Date(b.startTime), locale, facilityTz)}</p>
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
                      {isRequested ? t('common.pendingApproval') : t('common.scheduled')}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-3">{t('appts.past6Months')}</h2>
        {past.length === 0 ? (
          <p className="text-sm text-stone-400">{t('appts.noPast')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {past.map((b) => {
              const services = b.serviceNames?.join(', ') ?? t('common.service')
              const stylistName = stylistMap.get(b.stylistId) ?? '—'
              const photos = photosByBooking.get(b.id) ?? []
              return (
                <li key={b.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-stone-900">{formatDateTime(new Date(b.startTime), locale, facilityTz)}</p>
                      <p className="text-[12px] text-stone-500 mt-0.5">{services} · {stylistName}</p>
                    </div>
                    <span className="text-[10.5px] font-semibold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-700 shrink-0">
                      {t('common.completed')}
                    </span>
                  </div>
                  {photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {photos.map((p, i) => (
                        <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.url}
                            alt={p.caption ?? t('appts.stylePhoto')}
                            title={p.caption ?? undefined}
                            className="h-20 w-20 object-cover rounded-xl border border-stone-100"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
