import { getAuthUser } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import {
  bookings,
  stylists,
  complianceDocuments,
  stylistAvailability,
  stylistFacilityAssignments,
  stylistNotes,
  facilities,
  franchiseFacilities,
  profiles,
} from '@/db/schema'
import { getUserFacility, getUserFranchise, isAdminOrAbove } from '@/lib/get-facility-id'
import { sanitizeStylist } from '@/lib/sanitize'
import { createStorageClient, COMPLIANCE_BUCKET } from '@/lib/supabase/storage'
import { eq, and, gte, lte, ne, desc } from 'drizzle-orm'
import { StylistDetailClient } from './stylist-detail-client'

export default async function StylistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const user = await getAuthUser()
  if (!user) redirect('/login')

  // P39 — the master admin (env email, no facility_users row) supervises every
  // stylist: allow through and scope queries to the stylist's own facility.
  const suEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  const master = !!suEmail && user.email === suEmail
  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser && !master) redirect('/dashboard')
  if (facilityUser && !isAdminOrAbove(facilityUser.role)) redirect('/dashboard')

  try {
  const franchise = await getUserFranchise(user.id)
  const stylist = await db.query.stylists.findFirst({
    where: eq(stylists.id, id),
  })
  if (!stylist) notFound()

  // Allow if stylist belongs to caller's facility, OR franchise-pool stylist in
  // caller's franchise. Master bypasses scope entirely.
  if (!master && facilityUser) {
    const sameFacility = stylist.facilityId === facilityUser.facilityId
    const franchisePoolInFranchise =
      !!franchise && stylist.facilityId === null && stylist.franchiseId === franchise.franchiseId
    const sameFranchiseFacility =
      !!franchise &&
      stylist.facilityId !== null &&
      franchise.facilityIds.includes(stylist.facilityId)
    if (!sameFacility && !franchisePoolInFranchise && !sameFranchiseFacility) {
      notFound()
    }
  }

  // Facility scope for the stats/availability/compliance queries: the caller's
  // facility, or — for the master — the stylist's home facility / first active
  // assignment.
  let scopeFacilityId = facilityUser?.facilityId ?? stylist.facilityId ?? null
  if (!scopeFacilityId) {
    const firstAssignment = await db.query.stylistFacilityAssignments.findFirst({
      where: and(eq(stylistFacilityAssignments.stylistId, id), eq(stylistFacilityAssignments.active, true)),
      columns: { facilityId: true },
    })
    scopeFacilityId = firstAssignment?.facilityId ?? null
  }
  if (!scopeFacilityId) notFound()

  const now = new Date()
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  // Start of current week (Sunday)
  const startOfWeek = new Date(now)
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(now.getDate() - now.getDay())

  // Start of current month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  // All queries below depend only on (id, facilityUser, franchise, date anchors) —
  // fan them out in ONE Promise.all (audit 2026-07: was ~6 sequential awaits).
  const [
    upcomingBookings,
    allTimeBookings,
    allBookingsWithService,
    availability,
    docs,
    franchiseFacilityOptions,
    assignments,
    notes,
    linkedProfile,
  ] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, scopeFacilityId),
        eq(bookings.stylistId, id),
        gte(bookings.startTime, now),
        lte(bookings.startTime, in14Days),
        ne(bookings.status, 'cancelled')
      ),
      with: { resident: true, service: true },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    }),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, scopeFacilityId),
        eq(bookings.stylistId, id),
        ne(bookings.status, 'cancelled'),
        eq(bookings.active, true),
        eq(bookings.isDemo, false) // is_demo filter — Phase 13
      ),
    }),
    // This month's bookings with service names for the commission breakdown
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, scopeFacilityId),
        eq(bookings.stylistId, id),
        ne(bookings.status, 'cancelled'),
        gte(bookings.startTime, startOfMonth)
      ),
      with: { service: true },
    }),
    db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.stylistId, id),
        eq(stylistAvailability.facilityId, scopeFacilityId)
      ),
      orderBy: (t, { asc }) => [asc(t.dayOfWeek)],
    }),
    db.query.complianceDocuments.findMany({
      where: and(
        eq(complianceDocuments.stylistId, id),
        eq(complianceDocuments.facilityId, scopeFacilityId)
      ),
      orderBy: [desc(complianceDocuments.uploadedAt)],
    }),
    franchise
      ? db
          .select({ id: facilities.id, name: facilities.name })
          .from(facilities)
          .innerJoin(franchiseFacilities, eq(franchiseFacilities.facilityId, facilities.id))
          .where(eq(franchiseFacilities.franchiseId, franchise.franchiseId))
          .orderBy(facilities.name)
      : Promise.resolve([]),
    db
      .select({
        id: stylistFacilityAssignments.id,
        stylistId: stylistFacilityAssignments.stylistId,
        facilityId: stylistFacilityAssignments.facilityId,
        facilityName: facilities.name,
        commissionPercent: stylistFacilityAssignments.commissionPercent,
        active: stylistFacilityAssignments.active,
        createdAt: stylistFacilityAssignments.createdAt,
        updatedAt: stylistFacilityAssignments.updatedAt,
      })
      .from(stylistFacilityAssignments)
      .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
      .where(eq(stylistFacilityAssignments.stylistId, id))
      .orderBy(facilities.name),
    db
      .select({
        id: stylistNotes.id,
        stylistId: stylistNotes.stylistId,
        authorUserId: stylistNotes.authorUserId,
        body: stylistNotes.body,
        createdAt: stylistNotes.createdAt,
        updatedAt: stylistNotes.updatedAt,
        authorEmail: profiles.email,
      })
      .from(stylistNotes)
      .innerJoin(profiles, eq(profiles.id, stylistNotes.authorUserId))
      .where(eq(stylistNotes.stylistId, id))
      .orderBy(desc(stylistNotes.createdAt)),
    db.query.profiles.findFirst({
      where: eq(profiles.stylistId, id),
      columns: { id: true },
    }),
  ])

  const weekBookings = allTimeBookings.filter(
    (b) => new Date(b.startTime) >= startOfWeek
  )
  const monthBookings = allTimeBookings.filter(
    (b) => new Date(b.startTime) >= startOfMonth
  )

  const completedMonthBookings = allBookingsWithService.filter((b) => b.status === 'completed')
  const monthRevenue = completedMonthBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)

  const serviceBreakdownMap = new Map<string, { serviceName: string; count: number; revenueCents: number }>()
  for (const b of completedMonthBookings) {
    const key = b.serviceId ?? b.id
    const existing = serviceBreakdownMap.get(key)
    const price = b.priceCents ?? 0
    if (existing) {
      existing.count++
      existing.revenueCents += price
    } else {
      serviceBreakdownMap.set(key, { serviceName: b.service?.name ?? b.rawServiceName ?? 'Unknown service', count: 1, revenueCents: price })
    }
  }

  const serviceBreakdown = Array.from(serviceBreakdownMap.values())
    .map((row) => ({
      ...row,
      commissionCents: Math.round(row.revenueCents * stylist.commissionPercent / 100),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)

  const stats = {
    thisWeek: weekBookings.length,
    thisMonth: monthBookings.length,
    // revenue earned = completed only — scheduled/requested are booked, not earned
    totalRevenue: allTimeBookings.reduce(
      (sum, b) => sum + (b.status === 'completed' ? (b.priceCents ?? 0) : 0),
      0
    ),
    totalBookings: allTimeBookings.length,
    monthRevenue,
    serviceBreakdown,
  }

  const storage = createStorageClient()
  const complianceDocs = await Promise.all(
    docs.map(async (d) => {
      const { data } = await storage.storage
        .from(COMPLIANCE_BUCKET)
        .createSignedUrl(d.fileUrl, 3600)
      return { ...d, signedUrl: data?.signedUrl ?? null }
    })
  )

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  const isMasterAdmin = !!superAdminEmail && user.email === superAdminEmail

  const hasLinkedAccount = !!linkedProfile

  return (
    <StylistDetailClient
      stylist={JSON.parse(JSON.stringify(sanitizeStylist(stylist)))}
      upcomingBookings={JSON.parse(JSON.stringify(upcomingBookings))}
      stats={stats}
      complianceDocuments={JSON.parse(JSON.stringify(complianceDocs))}
      availability={JSON.parse(JSON.stringify(availability))}
      isAdmin={master || facilityUser?.role === 'admin'}
      isMasterAdmin={isMasterAdmin}
      franchiseFacilities={JSON.parse(JSON.stringify(franchiseFacilityOptions))}
      assignments={JSON.parse(JSON.stringify(assignments))}
      notes={JSON.parse(JSON.stringify(notes))}
      hasLinkedAccount={hasLinkedAccount}
      lastInviteSentAt={stylist.lastInviteSentAt ? String(stylist.lastInviteSentAt) : null}
    />
  )
  } catch (err) {
    console.error('[StylistDetailPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load stylist details. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
