import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { stylists, complianceDocuments, stylistFacilityAssignments, stylistAvailability } from '@/db/schema'
import { getUserFacility, canManageStylists, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and, inArray, or } from 'drizzle-orm'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { AddStylistInline } from '@/components/stylists/add-stylist-inline'
import { computeComplianceStatus, complianceStatusLabel } from '@/lib/compliance'

const STATUS_COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default async function StylistsPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  // P51 lockdown — the manage tier (master/franchise/bookkeeper — Round 6's
  // bookkeeper self-serve rides this) gets the full page (detail links,
  // compliance, add button); facility admin + front desk get a READ-ONLY
  // roster (names, colors, schedule days — no personal info, no click-through).
  const canManage = isMaster || canManageStylists(facilityUser)
  const rosterOnly = !canManage && (facilityUser.role === 'admin' || isFacilityStaff(facilityUser.role))
  if (!canManage && !rosterOnly) redirect('/dashboard')

  try {
  const assigned = await db
    .select({ id: stylistFacilityAssignments.stylistId })
    .from(stylistFacilityAssignments)
    .where(
      and(
        eq(stylistFacilityAssignments.facilityId, facilityUser.facilityId),
        eq(stylistFacilityAssignments.active, true),
      ),
    )
  const assignedIds = assigned.map((r) => r.id)

  // Roster rule (P33/P34b): home rows PLUS assignment-linked rows — this page
  // previously read assignments only and missed home stylists with no row.
  const stylistsList = await db.query.stylists.findMany({
    where: and(
      assignedIds.length
        ? or(eq(stylists.facilityId, facilityUser.facilityId), inArray(stylists.id, assignedIds))
        : eq(stylists.facilityId, facilityUser.facilityId),
      eq(stylists.active, true),
      eq(stylists.status, 'active'),
    ),
    // Roster view never loads personal columns
    columns: rosterOnly
      ? { id: true, name: true, color: true, specialties: true }
      : undefined,
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  // Manage tier only — compliance dots
  const stylistStatus = new Map<string, ReturnType<typeof computeComplianceStatus>>()
  if (canManage && stylistsList.length > 0) {
    const facilityDocs = await db.query.complianceDocuments.findMany({
      where: eq(complianceDocuments.facilityId, facilityUser.facilityId),
      columns: { stylistId: true, documentType: true, expiresAt: true, verified: true },
    })
    const docsByStylist = new Map<string, typeof facilityDocs>()
    for (const d of facilityDocs) {
      if (!docsByStylist.has(d.stylistId)) docsByStylist.set(d.stylistId, [])
      docsByStylist.get(d.stylistId)!.push(d)
    }
    for (const s of stylistsList) {
      stylistStatus.set(
        s.id,
        computeComplianceStatus(s as Parameters<typeof computeComplianceStatus>[0], docsByStylist.get(s.id) ?? [])
      )
    }
  }

  // Roster view — schedule days per stylist (one query)
  const daysByStylist = new Map<string, string>()
  if (rosterOnly && stylistsList.length > 0) {
    const windows = await db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.facilityId, facilityUser.facilityId),
        eq(stylistAvailability.active, true),
        inArray(stylistAvailability.stylistId, stylistsList.map((s) => s.id)),
      ),
      columns: { stylistId: true, dayOfWeek: true },
      orderBy: (t, { asc }) => [asc(t.dayOfWeek)],
    })
    const acc = new Map<string, number[]>()
    for (const w of windows) {
      if (!acc.has(w.stylistId)) acc.set(w.stylistId, [])
      if (!acc.get(w.stylistId)!.includes(w.dayOfWeek)) acc.get(w.stylistId)!.push(w.dayOfWeek)
    }
    for (const [id, days] of acc) daysByStylist.set(id, days.map((d) => DAY_LABEL[d]).join(' · '))
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-normal text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Stylists
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {stylistsList.length} active stylist{stylistsList.length !== 1 ? 's' : ''}
            {rosterOnly ? ' · schedules and profiles are managed by your franchise team' : ''}
          </p>
        </div>
        {canManage && <AddStylistInline />}
      </div>

      {stylistsList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <p className="text-stone-400 text-sm">
            {canManage ? 'No stylists yet. Add one with the button above.' : 'No stylists yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden" data-tour="stylists-table">
          {stylistsList.map((stylist) => {
            const rowInner = (
              <>
                <Avatar name={stylist.name} color={stylist.color} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-stone-900">{stylist.name}</p>
                    {!rosterOnly && 'licenseState' in stylist && stylist.licenseState && (
                      <span className="text-[10px] font-semibold text-stone-500 px-1.5 py-0.5 rounded bg-stone-100 shrink-0">
                        {(stylist.licenseState as string).split(',').map((s) => s.trim()).join(' • ')}
                      </span>
                    )}
                  </div>
                  {rosterOnly && daysByStylist.get(stylist.id) && (
                    <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5">
                      {daysByStylist.get(stylist.id)}
                    </p>
                  )}
                  {stylist.specialties && stylist.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stylist.specialties.map((s) => (
                        <span
                          key={s}
                          className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-xs font-medium"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: stylist.color }}
                  title="Calendar color"
                />
                {canManage && (() => {
                  const status = stylistStatus.get(stylist.id) ?? 'none'
                  if (status === 'none') return null
                  return (
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[status]}`}
                      title={`Compliance: ${complianceStatusLabel(status)}`}
                    />
                  )
                })()}
                {canManage && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-stone-300 shrink-0"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </>
            )
            return canManage ? (
              <Link
                key={stylist.id}
                href={`/stylists/${stylist.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0"
              >
                {rowInner}
              </Link>
            ) : (
              <div
                key={stylist.id}
                className="flex items-center gap-4 px-5 py-4 border-b border-stone-50 last:border-0"
              >
                {rowInner}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
  } catch (err) {
    console.error('[StylistsPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load stylists. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
