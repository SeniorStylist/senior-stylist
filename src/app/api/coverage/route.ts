import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  coverageRequests,
  facilityUsers,
  profiles,
  stylists,
} from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { sendEmail, buildCoverageRequestEmailHtml } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, asc, eq, lte, gte, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// 13F: 'pending' awaits admin approval; 'open' = approved, needs a substitute
const STATUS_VALUES = ['pending', 'open', 'filled', 'cancelled', 'denied'] as const

const createSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(2000).optional(),
    // P39 — admin/master file time off ON BEHALF of a stylist (supervisor
    // model). Stylist callers must omit this (forced self).
    stylistId: z.string().uuid().optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
  })

// P39 — master-email bypass (same local pattern as /api/stylists/[id]).
function isMasterCaller(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

/** Home row OR active assignment — the canonical works-at check (F228 rule). */
async function stylistWorksAt(stylistId: string, facilityId: string): Promise<boolean> {
  const home = await db.query.stylists.findFirst({
    where: (s, { and: a, eq: e }) => a(e(s.id, stylistId), e(s.facilityId, facilityId)),
    columns: { id: true },
  })
  if (home) return true
  const assignment = await db.query.stylistFacilityAssignments.findFirst({
    where: (r, { and: a, eq: e }) => a(e(r.stylistId, stylistId), e(r.facilityId, facilityId), e(r.active, true)),
    columns: { id: true },
  })
  return !!assignment
}

function todayUTCDateStr(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // P39 — master admin may read any facility's requests via ?facilityId=.
    const master = isMasterCaller(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser?.role === 'viewer') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    let scopeFacilityId: string
    if (master) {
      const facParam = z.string().uuid().safeParse(request.nextUrl.searchParams.get('facilityId'))
      if (!facParam.success) return Response.json({ error: 'facilityId required' }, { status: 422 })
      scopeFacilityId = facParam.data
    } else {
      scopeFacilityId = facilityUser!.facilityId
    }

    const statusParam = request.nextUrl.searchParams.get('status')
    const stylistIdParam = request.nextUrl.searchParams.get('stylistId')
    const statusParsed = statusParam
      ? z.enum(STATUS_VALUES).safeParse(statusParam)
      : null
    if (statusParsed && !statusParsed.success) {
      return Response.json({ error: 'Invalid status' }, { status: 422 })
    }

    let effectiveStylistId: string | null = null
    if (!master && facilityUser!.role !== 'admin') {
      const ownStylistId = await getEffectiveStylistId(user.id)
      if (!ownStylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      effectiveStylistId = ownStylistId
    } else if (stylistIdParam) {
      const parsed = z.string().uuid().safeParse(stylistIdParam)
      if (!parsed.success) return Response.json({ error: 'Invalid stylistId' }, { status: 422 })
      effectiveStylistId = parsed.data
    }

    const conditions = [eq(coverageRequests.facilityId, scopeFacilityId)]
    if (statusParsed?.success) conditions.push(eq(coverageRequests.status, statusParsed.data))
    if (effectiveStylistId) conditions.push(eq(coverageRequests.stylistId, effectiveStylistId))

    const requests = await db.query.coverageRequests.findMany({
      where: and(...conditions),
      with: {
        stylist: { columns: { id: true, name: true } },
        substituteStylist: { columns: { id: true, name: true } },
      },
      orderBy: [asc(coverageRequests.startDate), asc(coverageRequests.createdAt)],
    })

    return Response.json({ data: { requests } })
  } catch (err) {
    console.error('GET /api/coverage error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('coverage', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    // P39 — supervisor model: admins/franchise admins and the master admin may
    // file time off ON BEHALF of a stylist (body.stylistId). Their requests
    // start pre-approved ('open') since they ARE the approver. Stylist callers
    // keep the original self-only 'pending' flow.
    const master = isMasterCaller(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 422 })
    }

    const isSupervisor = master || facilityUser!.role === 'admin'
    let stylist: { id: string; name: string; facilityId: string | null } | undefined
    let scopeFacilityId: string
    let onBehalf = false

    if (isSupervisor && parsed.data.stylistId) {
      onBehalf = true
      stylist = await db.query.stylists.findFirst({
        where: eq(stylists.id, parsed.data.stylistId),
        columns: { id: true, name: true, facilityId: true },
      })
      if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })
      scopeFacilityId = facilityUser?.facilityId ?? stylist.facilityId ?? ''
      if (!scopeFacilityId) {
        return Response.json({ error: 'This stylist has no facility yet.' }, { status: 422 })
      }
      if (!(await stylistWorksAt(stylist.id, scopeFacilityId))) {
        return Response.json({ error: 'Stylist is not assigned to this facility' }, { status: 403 })
      }
    } else {
      if (master) {
        return Response.json({ error: 'Pass a stylistId to file time off for a stylist.' }, { status: 422 })
      }
      const ownStylistId = await getEffectiveStylistId(user.id)
      if (!ownStylistId) {
        return Response.json({ error: 'Only stylists can request coverage' }, { status: 403 })
      }
      stylist = await db.query.stylists.findFirst({
        where: eq(stylists.id, ownStylistId),
        columns: { id: true, name: true, facilityId: true },
      })
      scopeFacilityId = facilityUser!.facilityId
      if (!stylist || !(await stylistWorksAt(stylist.id, scopeFacilityId))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (parsed.data.startDate < todayUTCDateStr()) {
      return Response.json({ error: 'startDate must be today or later' }, { status: 422 })
    }

    // Overlap-based duplicate check: new.startDate <= existing.endDate AND new.endDate >= existing.startDate
    // 13F: pending requests count too — a second overlapping ask is a duplicate.
    const existingOpen = await db.query.coverageRequests.findFirst({
      where: and(
        eq(coverageRequests.stylistId, stylist.id),
        inArray(coverageRequests.status, ['pending', 'open']),
        lte(coverageRequests.startDate, parsed.data.endDate),
        gte(coverageRequests.endDate, parsed.data.startDate),
      ),
    })
    if (existingOpen) {
      return Response.json(
        { error: 'You already have a request overlapping that date range' },
        { status: 409 }
      )
    }

    const [inserted] = await db
      .insert(coverageRequests)
      .values({
        facilityId: scopeFacilityId,
        stylistId: stylist.id,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        reason: parsed.data.reason ?? null,
        // 13F: stylist requests start pending — an admin approves (→ open) or
        // denies. P39: supervisor-filed time off is pre-approved by definition.
        status: onBehalf ? 'open' : 'pending',
        ...(onBehalf ? { approvedBy: user.id, approvedAt: new Date() } : {}),
      })
      .returning()

    // P39 — supervisor-filed: the approver already knows; skip the admin
    // notification fan-out and return immediately.
    if (onBehalf) {
      return Response.json({ data: { request: inserted } })
    }

    const facility = await db.query.facilities.findFirst({
      where: (f, { eq: eqOp }) => eqOp(f.id, scopeFacilityId),
      columns: { name: true },
    })

    const admins = await db
      .select({ userId: facilityUsers.userId, email: profiles.email })
      .from(facilityUsers)
      .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
      .where(
        and(eq(facilityUsers.facilityId, scopeFacilityId), eq(facilityUsers.role, 'admin'))
      )

    const fallback = process.env.NEXT_PUBLIC_ADMIN_EMAIL
    const recipients = admins.map((a) => a.email).filter((e): e is string => !!e)
    const targets = recipients.length > 0 ? recipients : fallback ? [fallback] : []

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
    const html = buildCoverageRequestEmailHtml({
      stylistName: stylist.name,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason ?? null,
      facilityName: facility?.name ?? 'Facility',
      dashboardUrl: `${appUrl}/dashboard`,
    })
    const rangeLabel =
      parsed.data.startDate === parsed.data.endDate
        ? parsed.data.startDate
        : `${parsed.data.startDate} – ${parsed.data.endDate}`
    const subject = `Coverage request: ${stylist.name} needs ${rangeLabel}`
    for (const to of targets) {
      sendEmail({ to, subject, html }).catch((err) =>
        console.error('[coverage POST] send failed:', err)
      )
    }

    // In-app inbox + push for facility admins (Phase 15 F1) — reuses the admin
    // rows already loaded above (one batched insert inside notifyManyUsers).
    void import('@/lib/notify')
      .then(({ notifyManyUsers }) =>
        notifyManyUsers(
          admins.map((a) => ({
            userId: a.userId,
            payload: {
              type: 'coverage_request' as const,
              title: 'Time-off request',
              body: `${stylist.name} needs ${rangeLabel}`,
              url: '/dashboard',
              facilityId: scopeFacilityId,
            },
          })),
        ),
      )
      .catch((err) => console.error('[coverage POST] notify failed:', err))

    return Response.json({ data: { request: inserted } })
  } catch (err) {
    console.error('POST /api/coverage error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
