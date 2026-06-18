import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { residents, bookings, services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { toClientJson } from '@/lib/sanitize'
import { eq, and } from 'drizzle-orm'
import { ResidentDetailClient } from './resident-detail-client'
import { createStorageClient } from '@/lib/supabase/storage'

export default async function ResidentDetailPage({
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
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role === 'stylist') redirect('/dashboard')

  try {
  const resident = await db.query.residents.findFirst({
    where: and(
      eq(residents.id, id),
      eq(residents.facilityId, facilityUser.facilityId)
    ),
  })
  if (!resident) notFound()

  const residentBookings = await db.query.bookings.findMany({
    where: and(
      eq(bookings.residentId, id),
      eq(bookings.facilityId, facilityUser.facilityId),
      eq(bookings.active, true)
    ),
    with: {
      stylist: true,
      service: true,
    },
    orderBy: (t, { desc }) => [desc(t.startTime)],
  })

  // Compute stats
  const activeBookings = residentBookings.filter((b) => b.status !== 'cancelled')
  const totalSpent = activeBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)
  const firstVisitEntry = activeBookings.length > 0
    ? activeBookings[activeBookings.length - 1]
    : null
  const firstVisit = firstVisitEntry
    ? (firstVisitEntry.startTime instanceof Date
        ? firstVisitEntry.startTime.toISOString()
        : String(firstVisitEntry.startTime))
    : null

  // Most common service
  const serviceCounts = new Map<string, { name: string; count: number }>()
  for (const b of activeBookings) {
    const key = b.serviceId ?? b.id
    const existing = serviceCounts.get(key)
    if (!existing) {
      serviceCounts.set(key, { name: b.service?.name ?? b.rawServiceName ?? 'Unknown service', count: 1 })
    } else {
      existing.count++
    }
  }
  let mostCommonService: string | null = null
  let maxCount = 0
  for (const { name, count } of serviceCounts.values()) {
    if (count > maxCount) { mostCommonService = name; maxCount = count }
  }

  const stats = {
    total: activeBookings.length,
    totalSpent,
    mostCommonService,
    firstVisit,
  }

  // Load preferred service name if set
  let preferredServiceName: string | null = null
  if (resident.defaultServiceId) {
    const svc = await db.query.services.findFirst({
      where: eq(services.id, resident.defaultServiceId),
    })
    preferredServiceName = svc?.name ?? null
  }

  // Load facility services for the preferred service selector
  // is_demo filter — Phase 13 (real-only; this page doesn't drive scripted tours).
  const facilityServices = await db.query.services.findMany({
    where: and(eq(services.facilityId, facilityUser.facilityId), eq(services.active, true), eq(services.isDemo, false)),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  // Generate a 1-hour signed URL for the resident photo if one exists
  let photoUrl: string | null = null
  if (resident.photoPath) {
    try {
      const storage = createStorageClient()
      const { data } = await storage.storage
        .from('resident-photos')
        .createSignedUrl(resident.photoPath, 3600)
      photoUrl = data?.signedUrl ?? null
    } catch {
      // non-fatal — photo just won't display
    }
  }

  return (
    <ResidentDetailClient
      resident={{ ...toClientJson(resident), photoUrl }}
      bookings={toClientJson(residentBookings)}
      stats={stats}
      preferredServiceName={preferredServiceName}
      facilityServices={toClientJson(facilityServices)}
      role={facilityUser.role}
    />
  )
  } catch (err) {
    console.error('[ResidentDetailPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load resident details. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
