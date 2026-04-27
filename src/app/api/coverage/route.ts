import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  coverageRequests,
  facilityUsers,
  profiles,
  stylists,
} from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { sendEmail, buildCoverageRequestEmailHtml } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, asc, eq, lte, gte } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const STATUS_VALUES = ['open', 'filled', 'cancelled'] as const

const createSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(2000).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
  })

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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role === 'viewer') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
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
    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      effectiveStylistId = profile.stylistId
    } else if (stylistIdParam) {
      const parsed = z.string().uuid().safeParse(stylistIdParam)
      if (!parsed.success) return Response.json({ error: 'Invalid stylistId' }, { status: 422 })
      effectiveStylistId = parsed.data
    }

    const conditions = [eq(coverageRequests.facilityId, facilityUser.facilityId)]
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true, fullName: true },
    })
    if (!profile?.stylistId) {
      return Response.json({ error: 'Only stylists can request coverage' }, { status: 403 })
    }

    const stylist = await db.query.stylists.findFirst({
      where: eq(stylists.id, profile.stylistId),
      columns: { id: true, name: true, facilityId: true },
    })
    if (!stylist || stylist.facilityId !== facilityUser.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 422 })
    }

    if (parsed.data.startDate < todayUTCDateStr()) {
      return Response.json({ error: 'startDate must be today or later' }, { status: 422 })
    }

    // Overlap-based duplicate check: new.startDate <= existing.endDate AND new.endDate >= existing.startDate
    const existingOpen = await db.query.coverageRequests.findFirst({
      where: and(
        eq(coverageRequests.stylistId, stylist.id),
        eq(coverageRequests.status, 'open'),
        lte(coverageRequests.startDate, parsed.data.endDate),
        gte(coverageRequests.endDate, parsed.data.startDate),
      ),
    })
    if (existingOpen) {
      return Response.json(
        { error: 'You already have an open request overlapping that date range' },
        { status: 409 }
      )
    }

    const [inserted] = await db
      .insert(coverageRequests)
      .values({
        facilityId: facilityUser.facilityId,
        stylistId: stylist.id,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        reason: parsed.data.reason ?? null,
      })
      .returning()

    const facility = await db.query.facilities.findFirst({
      where: (f, { eq: eqOp }) => eqOp(f.id, facilityUser.facilityId),
      columns: { name: true },
    })

    const admins = await db
      .select({ email: profiles.email })
      .from(facilityUsers)
      .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
      .where(
        and(eq(facilityUsers.facilityId, facilityUser.facilityId), eq(facilityUsers.role, 'admin'))
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

    return Response.json({ data: { request: inserted } })
  } catch (err) {
    console.error('POST /api/coverage error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
