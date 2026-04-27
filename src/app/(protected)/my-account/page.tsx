import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import {
  profiles,
  stylists,
  bookings,
  complianceDocuments,
  stylistAvailability,
  coverageRequests,
  stylistFacilityAssignments,
  facilities,
  payPeriods,
  stylistPayItems,
  payDeductions,
} from '@/db/schema'
import { eq, and, gte, lte, desc, inArray } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { sanitizeStylist, sanitizeStylists } from '@/lib/sanitize'
import { createStorageClient, COMPLIANCE_BUCKET } from '@/lib/supabase/storage'
import { MyAccountClient } from './my-account-client'

export default async function MyAccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'stylist') redirect('/dashboard')

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  })

  let stylist = null
  let weekBookings: any[] = []
  let monthEarningsCents = 0
  let complianceDocs: Array<Record<string, unknown>> = []
  let availabilityRows: Array<Record<string, unknown>> = []
  let coverageRows: Array<Record<string, unknown>> = []
  let stylistAssignments: Array<{ facilityId: string; facilityName: string; active: boolean }> = []
  let payHistory: Array<Record<string, unknown>> = []
  let payHistoryDeductions: Array<Record<string, unknown>> = []

  if (profile?.stylistId) {
    stylist = await db.query.stylists.findFirst({
      where: eq(stylists.id, profile.stylistId),
    })

    if (stylist) {
      // This week's bookings
      const now = new Date()
      const dayOfWeek = now.getDay()
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - dayOfWeek)
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 7)

      // This month's earnings range
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

      // Fan out 7 independent stylist-scoped queries in parallel.
      const [
        weekBookingsRes,
        monthBookings,
        docs,
        availabilityRowsRes,
        coverageRowsRes,
        stylistAssignmentsRes,
        payHistoryRes,
      ] = await Promise.all([
        db.query.bookings.findMany({
          where: and(
            eq(bookings.facilityId, facilityUser.facilityId),
            eq(bookings.stylistId, stylist.id),
            gte(bookings.startTime, weekStart),
            lte(bookings.startTime, weekEnd),
          ),
          with: { resident: true, service: true },
          orderBy: (t, { asc }) => [asc(t.startTime)],
        }),
        db.query.bookings.findMany({
          where: and(
            eq(bookings.facilityId, facilityUser.facilityId),
            eq(bookings.stylistId, stylist.id),
            gte(bookings.startTime, monthStart),
            lte(bookings.startTime, monthEnd),
            eq(bookings.status, 'completed'),
          ),
        }),
        db.query.complianceDocuments.findMany({
          where: and(
            eq(complianceDocuments.stylistId, stylist.id),
            eq(complianceDocuments.facilityId, facilityUser.facilityId)
          ),
          orderBy: [desc(complianceDocuments.uploadedAt)],
        }),
        db.query.stylistAvailability.findMany({
          where: and(
            eq(stylistAvailability.stylistId, stylist.id),
            eq(stylistAvailability.facilityId, facilityUser.facilityId)
          ),
          orderBy: (t, { asc }) => [asc(t.dayOfWeek)],
        }),
        db.query.coverageRequests.findMany({
          where: and(
            eq(coverageRequests.stylistId, stylist.id),
            eq(coverageRequests.facilityId, facilityUser.facilityId)
          ),
          orderBy: (t, { asc }) => [asc(t.startDate)],
        }),
        db
          .select({
            facilityId: stylistFacilityAssignments.facilityId,
            facilityName: facilities.name,
            active: stylistFacilityAssignments.active,
          })
          .from(stylistFacilityAssignments)
          .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
          .where(
            and(
              eq(stylistFacilityAssignments.stylistId, stylist.id),
              eq(stylistFacilityAssignments.active, true),
            ),
          ),
        db
          .select({
            periodId: payPeriods.id,
            startDate: payPeriods.startDate,
            endDate: payPeriods.endDate,
            status: payPeriods.status,
            facilityName: facilities.name,
            grossRevenueCents: stylistPayItems.grossRevenueCents,
            netPayCents: stylistPayItems.netPayCents,
            commissionRate: stylistPayItems.commissionRate,
            commissionAmountCents: stylistPayItems.commissionAmountCents,
            payItemId: stylistPayItems.id,
          })
          .from(stylistPayItems)
          .innerJoin(payPeriods, eq(stylistPayItems.payPeriodId, payPeriods.id))
          .innerJoin(facilities, eq(payPeriods.facilityId, facilities.id))
          .where(eq(stylistPayItems.stylistId, stylist.id))
          .orderBy(desc(payPeriods.startDate))
          .limit(12),
      ])

      weekBookings = weekBookingsRes
      availabilityRows = availabilityRowsRes
      coverageRows = coverageRowsRes
      stylistAssignments = stylistAssignmentsRes
      payHistory = payHistoryRes

      monthEarningsCents = monthBookings.reduce((sum, b) => {
        const price = b.priceCents ?? 0
        return sum + Math.round(price * (stylist!.commissionPercent / 100))
      }, 0)

      const storage = createStorageClient()
      complianceDocs = await Promise.all(
        docs.map(async (d) => {
          const { data } = await storage.storage
            .from(COMPLIANCE_BUCKET)
            .createSignedUrl(d.fileUrl, 3600)
          return { ...d, signedUrl: data?.signedUrl ?? null }
        })
      )

      const payItemIds = payHistory.map((h) => h.payItemId as string).filter(Boolean)
      if (payItemIds.length > 0) {
        payHistoryDeductions = await db.query.payDeductions.findMany({
          where: inArray(payDeductions.payItemId, payItemIds),
          columns: { payItemId: true, deductionType: true, amountCents: true },
        }) as Array<Record<string, unknown>>
      }
    }
  }

  // Load all facility stylists for the link-selector
  const facilityStylists = await db.query.stylists.findMany({
    where: and(eq(stylists.facilityId, facilityUser.facilityId), eq(stylists.active, true)),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  return (
    <MyAccountClient
      user={{ email: user.email ?? '', fullName: user.user_metadata?.full_name ?? null }}
      stylist={stylist ? JSON.parse(JSON.stringify(sanitizeStylist(stylist))) : null}
      weekBookings={JSON.parse(JSON.stringify(weekBookings))}
      monthEarningsCents={monthEarningsCents}
      linked={!!profile?.stylistId}
      facilityStylists={JSON.parse(JSON.stringify(sanitizeStylists(facilityStylists)))}
      googleCalendarConnected={!!(stylist?.googleCalendarId)}
      complianceDocuments={JSON.parse(JSON.stringify(complianceDocs))}
      availability={JSON.parse(JSON.stringify(availabilityRows))}
      coverageRequests={JSON.parse(JSON.stringify(coverageRows))}
      stylistId={profile?.stylistId ?? null}
      stylistAssignments={JSON.parse(JSON.stringify(stylistAssignments))}
      payHistory={JSON.parse(JSON.stringify(payHistory))}
      payHistoryDeductions={JSON.parse(JSON.stringify(payHistoryDeductions))}
    />
  )
}
