import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { feedbackSubmissions, facilities, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendEmail, buildFeedbackEmailHtml } from '@/lib/email'
import { ensureFeedbackSchema } from '@/lib/feedback-ddl'
import { eq, desc } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const metaSchema = z.object({
  viewport: z.string().max(20),
  screen: z.string().max(20),
  dpr: z.number(),
  timezone: z.string().max(100),
  language: z.string().max(20),
  standalone: z.boolean(),
  online: z.boolean(),
}).partial()

const createSchema = z.object({
  category: z.enum(['bug', 'idea', 'praise', 'other']),
  message: z.string().min(2).max(2000),
  pagePath: z.string().max(300).optional(),
  meta: metaSchema.optional(),
})

// Short human summary for the notification email, e.g. "iPhone · 390x844 · PWA · America/New_York"
function deviceSummary(userAgent: string | null, meta: z.infer<typeof metaSchema> | undefined): string | null {
  const parts: string[] = []
  if (userAgent) {
    if (/iPhone/i.test(userAgent)) parts.push('iPhone')
    else if (/iPad/i.test(userAgent)) parts.push('iPad')
    else if (/Android/i.test(userAgent)) parts.push('Android')
    else if (/Macintosh/i.test(userAgent)) parts.push('Mac')
    else if (/Windows/i.test(userAgent)) parts.push('Windows')
  }
  if (meta?.viewport) parts.push(meta.viewport)
  if (meta?.standalone) parts.push('PWA')
  if (meta?.timezone) parts.push(meta.timezone)
  if (meta?.online === false) parts.push('offline')
  return parts.length > 0 ? parts.join(' · ') : null
}

export async function POST(request: NextRequest) {
  try {
    await ensureFeedbackSchema()

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('feedback', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request' }, { status: 422 })
    }
    const { category, message, pagePath, meta } = parsed.data
    const userAgent = request.headers.get('user-agent')?.slice(0, 300) ?? null

    // Facility/role context is best-effort — feedback must save even when the
    // sender has no facility (e.g. master admin browsing).
    const facilityUser = await getUserFacility(user.id)

    const [profile, facility] = await Promise.all([
      db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { fullName: true },
      }),
      facilityUser
        ? db.query.facilities.findFirst({
            where: eq(facilities.id, facilityUser.facilityId),
            columns: { name: true },
          })
        : Promise.resolve(null),
    ])

    await db.insert(feedbackSubmissions).values({
      facilityId: facilityUser?.facilityId ?? null,
      userId: user.id,
      role: facilityUser?.role ?? null,
      category,
      message,
      pagePath: pagePath ?? null,
      userAgent,
      meta: meta ?? null,
    })

    // Notify the product owner — fire-and-forget (background notification).
    // Use the master admin's custom feedbackEmail if set, otherwise fall back to env.
    const masterEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    let notifyTo: string | undefined = masterEmail
    if (masterEmail) {
      const masterProfile = await db.query.profiles.findFirst({
        where: eq(profiles.email, masterEmail),
        columns: { feedbackEmail: true },
      }).catch(() => null)
      if (masterProfile?.feedbackEmail) notifyTo = masterProfile.feedbackEmail
    }
    if (notifyTo) {
      sendEmail({
        to: notifyTo,
        subject: `Feedback (${category}): ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
        html: buildFeedbackEmailHtml({
          category,
          message,
          senderName: profile?.fullName ?? user.email ?? 'Unknown user',
          senderRole: facilityUser?.role ?? null,
          facilityName: facility?.name ?? null,
          pagePath: pagePath ?? null,
          device: deviceSummary(userAgent, meta),
        }),
      }).catch(() => {})
    }

    return Response.json({ data: { ok: true } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/feedback error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    await ensureFeedbackSchema()

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await db.query.feedbackSubmissions.findMany({
      orderBy: [desc(feedbackSubmissions.createdAt)],
      limit: 200,
    })

    // Resolve names in two batch lookups (no N+1)
    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))]
    const facilityIds = [...new Set(rows.map((r) => r.facilityId).filter((v): v is string => !!v))]
    const [profileRows, facilityRows] = await Promise.all([
      userIds.length
        ? db.query.profiles.findMany({
            where: (t, { inArray }) => inArray(t.id, userIds),
            columns: { id: true, fullName: true, email: true },
          })
        : Promise.resolve([]),
      facilityIds.length
        ? db.query.facilities.findMany({
            where: (t, { inArray }) => inArray(t.id, facilityIds),
            columns: { id: true, name: true },
          })
        : Promise.resolve([]),
    ])
    const profileMap = new Map(profileRows.map((p) => [p.id, p.fullName ?? p.email ?? '—']))
    const facilityMap = new Map(facilityRows.map((f) => [f.id, f.name]))

    return Response.json({
      data: rows.map((r) => ({
        id: r.id,
        category: r.category,
        message: r.message,
        status: r.status,
        role: r.role,
        pagePath: r.pagePath,
        meta: r.meta ?? null,
        createdAt: r.createdAt,
        senderName: r.userId ? profileMap.get(r.userId) ?? '—' : '—',
        facilityName: r.facilityId ? facilityMap.get(r.facilityId) ?? '—' : null,
      })),
    })
  } catch (err) {
    console.error('GET /api/feedback error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
