// Phase 15 F4 — cancellation waitlist. Residents waiting for an earlier/open
// slot; matched against freed slots by src/lib/waitlist-match.ts on cancel.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents, services, stylists, waitlistEntries } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { ensureWaitlistSchema } from '@/lib/waitlist-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { getPendingWaitlist } from '@/lib/dashboard-panels'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const createSchema = z.object({
  // P41 — master admin only: target ANY active facility. IGNORED otherwise.
  facilityId: z.string().uuid().optional(),
  residentId: z.string().uuid().nullable().optional(),
  residentName: z.string().min(1).max(200),
  roomNumber: z.string().max(50).nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  serviceName: z.string().max(200).nullable().optional(),
  preferredStylistId: z.string().uuid().nullable().optional(),
  earliestDate: z.string().regex(DATE_RE),
  latestDate: z.string().regex(DATE_RE).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // P41 — master admin adds waitlist entries at ANY active facility via
    // body facilityId; other callers' facility is authoritative (IGNORED).
    const master =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master) {
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('waitlist', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const d = parsed.data

    let facilityId: string
    if (master) {
      if (!d.facilityId) return Response.json({ error: 'facilityId is required for master admin' }, { status: 422 })
      const { facilities } = await import('@/db/schema')
      const target = await db.query.facilities.findFirst({
        where: and(eq(facilities.id, d.facilityId), eq(facilities.active, true)),
        columns: { id: true },
      })
      if (!target) return Response.json({ error: 'Facility not found' }, { status: 404 })
      facilityId = target.id
    } else {
      facilityId = facilityUser!.facilityId
    }

    await ensureWaitlistSchema()

    // Facility-scope every provided id (IDOR guard)
    let roomNumber = d.roomNumber ?? null
    if (d.residentId) {
      const resident = await db.query.residents.findFirst({
        where: and(eq(residents.id, d.residentId), eq(residents.facilityId, facilityId)),
        columns: { id: true, roomNumber: true },
      })
      if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })
      roomNumber = roomNumber ?? resident.roomNumber
    }
    let serviceName = d.serviceName ?? null
    if (d.serviceId) {
      const service = await db.query.services.findFirst({
        where: and(eq(services.id, d.serviceId), eq(services.facilityId, facilityId)),
        columns: { id: true, name: true },
      })
      if (!service) return Response.json({ error: 'Service not found' }, { status: 404 })
      serviceName = service.name
    }
    if (d.preferredStylistId) {
      const stylist = await db.query.stylists.findFirst({
        where: and(eq(stylists.id, d.preferredStylistId), eq(stylists.active, true)),
        columns: { id: true, facilityId: true },
      })
      if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })
    }
    if (d.latestDate && d.latestDate < d.earliestDate) {
      return Response.json({ error: 'End of window is before its start' }, { status: 422 })
    }

    const [entry] = await db
      .insert(waitlistEntries)
      .values({
        facilityId,
        residentId: d.residentId ?? null,
        residentName: d.residentName.trim(),
        roomNumber,
        serviceId: d.serviceId ?? null,
        serviceName,
        preferredStylistId: d.preferredStylistId ?? null,
        earliestDate: d.earliestDate,
        latestDate: d.latestDate ?? null,
        notes: d.notes?.trim() || null,
        createdBy: user.id,
        isDemo: isTutorialRequest(request),
      })
      .returning()

    return Response.json({ data: entry })
  } catch (err) {
    console.error('POST /api/waitlist error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    // P30 lockdown — the waitlist is an office surface (WaitlistPanel is
    // admin-only) and rows carry other stylists' assignments; stylists 403.
    if (facilityUser.role === 'viewer' || facilityUser.role === 'stylist') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Phase 25 — shared with GET /api/dashboard/panels (lib/dashboard-panels.ts)
    const data = await getPendingWaitlist(facilityUser.facilityId, isTutorialRequest(request))

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/waitlist error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
