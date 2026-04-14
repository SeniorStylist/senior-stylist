import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { accessRequests } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

const createSchema = z.object({
  facilityId: z.string().uuid().optional().nullable(),
  email: z.string().email().max(320),
  fullName: z.string().max(200).optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(['stylist', 'admin', 'viewer']).optional(),
})

// POST — public, no auth required
export async function POST(request: NextRequest) {
  try {
    const rl = await checkRateLimit('signup', getClientIp(request))
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { facilityId, email, fullName, userId, role } = parsed.data
    const normalizedEmail = email.toLowerCase().trim()

    // Idempotent: check for existing pending request by email
    const existing = await db.query.accessRequests.findFirst({
      where: (t) => and(eq(t.email, normalizedEmail), eq(t.status, 'pending')),
    })

    if (existing) {
      return Response.json({ data: { id: existing.id, alreadyExists: true } })
    }

    const [created] = await db
      .insert(accessRequests)
      .values({
        facilityId: facilityId ?? null,
        email: normalizedEmail,
        fullName: fullName ?? null,
        userId: userId ?? null,
        role: role ?? 'stylist',
        status: 'pending',
      })
      .returning()

    // Notify admin (fire-and-forget)
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL
    if (adminEmail) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
      sendEmail({
        to: adminEmail,
        subject: 'New access request — Senior Stylist',
        html: `
          <p>A new access request has been submitted.</p>
          <ul>
            <li><strong>Name:</strong> ${fullName ?? '(not provided)'}</li>
            <li><strong>Email:</strong> ${normalizedEmail}</li>
            <li><strong>Role:</strong> ${role ?? 'stylist'}</li>
          </ul>
          <p><a href="${appUrl}/super-admin">Review in admin</a></p>
        `,
      })
    }

    return Response.json({ data: { id: created.id } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/access-requests error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — facility admin only, scoped to their facility
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const requests = await db.query.accessRequests.findMany({
      where: (t) => and(
        eq(t.facilityId, facilityUser.facilityId),
        eq(t.status, 'pending')
      ),
      orderBy: (t) => [desc(t.createdAt)],
    })

    return Response.json({ data: requests })
  } catch (err) {
    console.error('GET /api/access-requests error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
